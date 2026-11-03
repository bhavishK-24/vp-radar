<#
  ValuePickr "Stock Opportunities" scraper  ->  site\data.js
  Everything shown on the site comes from ValuePickr (posts, comments, authors, likes).
  Prices (Yahoo Finance) are used only to measure how each call played out.
  Screener's public search is used only to turn a thread title into a ticker.
  Everything is cached under .\cache so re-runs are fast and polite.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\scrape.ps1
    powershell -ExecutionPolicy Bypass -File .\scrape.ps1 -Latest 100 -TrackTopics 500
#>
[CmdletBinding()]
param(
  [int]$Latest = 60,            # newest threads to process (post text + comments)
  [int]$TrackTopics = 250,      # older threads to judge for the track record (most-discussed first)
  [int]$PerAuthor = 15,         # older threads per author-of-a-latest-post to also judge
  [int]$MinTrackAgeDays = 365,  # a call must be at least this old to be judged
  [int]$Comments = 5,           # latest comments per thread
  [switch]$NoCache
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root     = $PSScriptRoot
$CacheDir = Join-Path $Root 'cache'
$SiteDir  = Join-Path $Root 'site'
$UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
$Forum    = 'https://forum.valuepickr.com'
$CatId    = 11
$CatSlug  = 'stock-opportunities'
$Now      = [DateTime]::UtcNow
$Inv      = [Globalization.CultureInfo]::InvariantCulture
$Utf8     = New-Object Text.UTF8Encoding $false
$HostDelay = @{ 'forum.valuepickr.com' = 700; 'www.screener.in' = 2500; 'query1.finance.yahoo.com' = 250 }

function Log([string]$m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

# ---------------------------------------------------------------- HTTP + cache
$script:lastHit = @{}
function Invoke-Http([string]$url) {
  $h = ([Uri]$url).Host
  $delay = 500; if ($HostDelay.ContainsKey($h)) { $delay = $HostDelay[$h] }
  if ($script:lastHit.ContainsKey($h)) {
    $wait = $delay - ((Get-Date) - $script:lastHit[$h]).TotalMilliseconds
    if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]$wait) }
  }
  for ($i = 1; $i -le 5; $i++) {
    try {
      $wc = New-Object Net.WebClient
      $wc.Encoding = [Text.Encoding]::UTF8
      $wc.Headers['User-Agent'] = $UA
      $wc.Headers['Accept'] = 'application/json, text/html;q=0.9, */*;q=0.8'
      $r = $wc.DownloadString($url)
      $script:lastHit[$h] = Get-Date
      return $r
    } catch {
      $script:lastHit[$h] = Get-Date
      $ex = $_.Exception
      while ($ex -and -not ($ex -is [Net.WebException])) { $ex = $ex.InnerException }
      $code = 0
      if ($ex -and $ex.Response) { $code = [int]$ex.Response.StatusCode }
      if ($code -eq 404 -or $code -eq 400 -or $code -eq 403) { return '__NULL__' }
      if ($i -lt 5) {
        $s = [Math]::Min(120, 10 * [Math]::Pow(2, $i - 1))
        Log "    HTTP $code from $h - retrying in ${s}s"
        Start-Sleep -Seconds $s
      }
    }
  }
  Log "    giving up on $url"
  return $null
}

# ttlHours < 0 => cache forever
function Get-Cached([string]$kind, [string]$key, [double]$ttlHours, [string]$url) {
  $dir = Join-Path $CacheDir $kind
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $file = Join-Path $dir (($key -replace '[^A-Za-z0-9_.-]', '_') + '.txt')
  if (-not $NoCache -and (Test-Path $file)) {
    $age = ($Now - (Get-Item $file).LastWriteTimeUtc).TotalHours
    if ($ttlHours -lt 0 -or $age -lt $ttlHours) {
      $t = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
      if ($t -eq '__NULL__') { return $null }
      return $t
    }
  }
  $txt = Invoke-Http $url
  if ($null -ne $txt) { [IO.File]::WriteAllText($file, $txt, $Utf8) }
  if ($txt -eq '__NULL__') { return $null }
  return $txt
}

# ---------------------------------------------------------------- helpers
function To-Epoch([string]$iso) { return [DateTimeOffset]::Parse($iso, $Inv).ToUnixTimeSeconds() }
function Html-ToText([string]$html, [switch]$DropQuotes) {
  if (-not $html) { return '' }
  $s = $html
  if ($DropQuotes) { $s = [regex]::Replace($s, '(?s)<aside class="quote.*?</aside>', ' ') }
  $s = [regex]::Replace($s, '(?s)<aside class="onebox.*?</aside>', ' ')
  $s = [regex]::Replace($s, '(?s)<div class="meta">.*?</div>', ' ')
  $s = [regex]::Replace($s, '(?s)<(script|style|svg)[^>]*>.*?</\1>', ' ')
  $s = [regex]::Replace($s, '<h[1-6][^>]*>', "`n## ")
  $s = [regex]::Replace($s, '</h[1-6]>', "`n")
  $s = [regex]::Replace($s, '<li[^>]*>', "`n• ")
  $s = [regex]::Replace($s, '<br\s*/?>', "`n")
  $s = [regex]::Replace($s, '</(p|div|tr|blockquote|ul|ol|table)>', "`n")
  $s = [regex]::Replace($s, '</t[dh]>', ' | ')
  $s = $s -replace '<[^>]+>', ''
  $s = [Net.WebUtility]::HtmlDecode($s)
  $lines = $s -split "`n" | ForEach-Object { ($_ -replace '[ \t ]+', ' ').Trim() }
  $s = ($lines -join "`n")
  $s = [regex]::Replace($s, "\n{3,}", "`n`n")
  return $s.Trim()
}
function Truncate([string]$s, [int]$n) { if ($s.Length -le $n) { return $s }; return $s.Substring(0, $n) + ' …' }
function Likes($post) { $l = 0; foreach ($a in @($post.actions_summary)) { if ($a.id -eq 2) { $l = [int]$a.count } }; return $l }

# ---------------------------------------------------------------- 1. topic list
Log "Fetching Stock Opportunities topic list (sorted by creation date)…"
$users = @{}
$topicsById = [ordered]@{}
for ($p = 0; $p -lt 300; $p++) {
  $txt = Get-Cached 'list' "created_p$p" 6 "$Forum/c/$CatSlug/$CatId/l/latest.json?order=created&ascending=false&page=$p"
  if (-not $txt) { break }
  $j = $txt | ConvertFrom-Json
  foreach ($u in @($j.users)) { $users[[string]$u.id] = $u }
  $ts = @($j.topic_list.topics)
  if ($ts.Count -eq 0) { break }
  foreach ($t in $ts) {
    if ($t.pinned -or $t.id -eq 17) { continue }
    if ($topicsById.Contains([string]$t.id)) { continue }
    $op = $null
    foreach ($ps in @($t.posters)) { if ($ps.description -like '*Original Poster*') { $op = $users[[string]$ps.user_id]; break } }
    $topicsById[[string]$t.id] = [ordered]@{
      id         = [int]$t.id
      title      = [Net.WebUtility]::HtmlDecode($t.title)
      url        = "$Forum/t/$($t.slug)/$($t.id)"
      created    = $t.created_at
      last       = $t.last_posted_at
      posts      = [int]$t.posts_count
      likes      = [int]$t.like_count
      views      = [int]$t.views
      author     = $(if ($op) { $op.username } else { $null })
      authorName = $(if ($op) { $op.name } else { $null })
      stock      = $null
    }
  }
  if (($p % 10) -eq 0) { Log "  page $p … $($topicsById.Count) topics" }
  if (-not $j.topic_list.more_topics_url) { break }
}
$all = @($topicsById.Values | Sort-Object { $_.created } -Descending)
Log "Total topics: $($all.Count)"

# ---------------------------------------------------------------- 2. choose which threads to process
$latestTopics = @($all | Select-Object -First $Latest)
$latestSet = @{}; foreach ($t in $latestTopics) { $latestSet[[string]$t.id] = $true }
$cutoff = $Now.AddDays(-$MinTrackAgeDays)
$older = @($all | Where-Object { [DateTime]::Parse($_.created, $Inv).ToUniversalTime() -lt $cutoff })
$latestAuthors = @($latestTopics | ForEach-Object { $_.author } | Where-Object { $_ } | Select-Object -Unique)
$trackSet = [ordered]@{}
foreach ($a in $latestAuthors) {
  foreach ($t in @($older | Where-Object { $_.author -eq $a } | Select-Object -First $PerAuthor)) { $trackSet[[string]$t.id] = $t }
}
foreach ($t in @($older | Sort-Object { $_.likes + 0.5 * $_.posts } -Descending | Select-Object -First $TrackTopics)) { $trackSet[[string]$t.id] = $t }
$toProcess = @($latestTopics) + @($trackSet.Values)
Log "Processing $($latestTopics.Count) latest + $($trackSet.Count) older threads (authors of latest posts + most discussed)"

# ---------------------------------------------------------------- 3. original post + latest comments
Log "Fetching original post + latest $Comments comments per thread…"
$n = 0
foreach ($t in $toProcess) {
  $n++
  $isLatest = $latestSet.ContainsKey([string]$t.id)
  $ttl = if ($isLatest) { 6 } else { 24 }
  $txt = Get-Cached 'topic' "$($t.id)" $ttl "$Forum/t/$($t.id).json"
  if (-not $txt) { continue }
  $j = $txt | ConvertFrom-Json
  $posts = @{}
  foreach ($p in @($j.post_stream.posts)) { $posts[[string]$p.id] = $p }
  $first = @($j.post_stream.posts | Where-Object { $_.post_number -eq 1 })[0]
  $stream = @($j.post_stream.stream)
  $lastIds = @($stream | Select-Object -Last $Comments | Where-Object { -not $first -or $_ -ne $first.id })
  $need = @($lastIds | Where-Object { -not $posts.ContainsKey([string]$_) })
  if ($need.Count -gt 0) {
    $q = ($need | ForEach-Object { "post_ids[]=$_" }) -join '&'
    $txt2 = Get-Cached 'posts' "$($t.id)_$($need[-1])" $ttl "$Forum/t/$($t.id)/posts.json?$q"
    if ($txt2) { foreach ($p in @(($txt2 | ConvertFrom-Json).post_stream.posts)) { $posts[[string]$p.id] = $p } }
  }
  $cm = @()
  foreach ($id in $lastIds) {
    $p = $posts[[string]$id]; if (-not $p) { continue }
    $cm += [ordered]@{ n = [int]$p.post_number; user = $p.username; name = $p.name; date = $p.created_at; likes = (Likes $p)
                       text = (Truncate (Html-ToText $p.cooked -DropQuotes) 1800) }
  }
  [array]::Reverse($cm)   # newest first
  if ($first) {
    $t['body'] = Truncate (Html-ToText $first.cooked) $(if ($isLatest) { 16000 } else { 6000 })
    $t['opLikes'] = Likes $first
  }
  $t['comments'] = $cm
  if (($n % 25) -eq 0) { Log "  $n / $($toProcess.Count)" }
}

# ---------------------------------------------------------------- 4. thread -> ticker (only to fetch prices)
$overrides = @{}
$ovFile = Join-Path $Root 'config\overrides.json'
if (Test-Path $ovFile) {
  $ov = [IO.File]::ReadAllText($ovFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
  foreach ($pr in $ov.PSObject.Properties) { if ($pr.Name -notlike '_*') { $overrides[$pr.Name] = $pr.Value } }
}
$Stop = @('ltd', 'limited', 'the', 'and', 'co', 'company', 'corp', 'corporation', 'pvt', 'private', 'inc', 'plc', 'india', 'indian', 'industries', 'inds', 'nse', 'bse', 'of', 'a', 'an', 'in', 'is')
function Tokens([string]$s) {
  $s = $s.ToLower() -replace '&', ' ' -replace '[^a-z0-9 ]', ' '
  return @($s -split '\s+' | Where-Object { $_ -and ($Stop -notcontains $_) })
}
function Name-Candidates([string]$title) {
  $c = New-Object 'System.Collections.Generic.List[string]'
  $parts = [regex]::Split($title, '\s[-–—|]\s|\s[-–—]|[-–—]\s|:|\||\(|\)|\?|,')
  $parts = @($parts | ForEach-Object { ($_ -replace '\b(NSE|BSE)\b', '' -replace '\s+', ' ').Trim() } | Where-Object { $_.Length -ge 2 })
  if ($parts.Count -gt 0) { $c.Add($parts[0]) }
  foreach ($m in [regex]::Matches($title, '\(([^)]{2,40})\)')) { $c.Add(($m.Groups[1].Value -replace '\b(NSE|BSE)\b\s*:?', '').Trim()) }
  if ($parts.Count -gt 0) {
    $tk = @(Tokens $parts[0])
    if ($tk.Count -ge 2 -and $tk.Count -le 4) { $c.Add(($tk[0..1] -join ' ')); if ($tk[0].Length -ge 5) { $c.Add($tk[0]) } }
  }
  foreach ($p in ($parts | Select-Object -Skip 1)) { $c.Add($p) }
  return @($c | Where-Object { $_ -and ((Tokens $_).Count -ge 1) -and ((Tokens $_).Count -le 7) } | Select-Object -Unique -First 5)
}
function Accept-Match([string]$cand, $res) {
  $slug = ($res.url -split '/')[2]
  if ($cand.Trim().ToUpper() -eq $slug.ToUpper()) { return $true }
  $ct = @(Tokens $cand); $rt = @(Tokens $res.name)
  if ($ct.Count -eq 0 -or $rt.Count -eq 0) { return $false }
  $hit = 0
  foreach ($x in $ct) { foreach ($y in $rt) { if ($x -eq $y -or ($x.Length -ge 4 -and $y.StartsWith($x)) -or ($y.Length -ge 4 -and $x.StartsWith($y))) { $hit++; break } } }
  $firstOk = $false
  foreach ($y in $rt) { if ($y -eq $ct[0] -or ($ct[0].Length -ge 4 -and $y.StartsWith($ct[0])) -or ($y.Length -ge 4 -and $ct[0].StartsWith($y))) { $firstOk = $true } }
  return ($firstOk -and $hit -ge [Math]::Ceiling([Math]::Min($ct.Count, $rt.Count) * 0.5))
}
function Resolve-Stock($t) {
  $k = [string]$t.id
  if ($overrides.ContainsKey($k)) {
    $v = $overrides[$k]; if (-not $v) { return $null }
    return [ordered]@{ slug = $v; name = $v }
  }
  foreach ($cand in (Name-Candidates $t.title)) {
    $q = [Uri]::EscapeDataString($cand)
    $txt = Get-Cached 'search' $cand.ToLower() -1 "https://www.screener.in/api/company/search/?q=$q&v=3&fts=1"
    if (-not $txt) { continue }
    $res = @(($txt | ConvertFrom-Json) | Where-Object { $_.url -like '/company/*' })
    foreach ($r in ($res | Select-Object -First 3)) {
      if (Accept-Match $cand $r) { return [ordered]@{ slug = ($r.url -split '/')[2]; name = $r.name } }
    }
  }
  return $null
}
Log "Matching threads to listed tickers…"
$stocks = [ordered]@{}
$n = 0
foreach ($t in $toProcess) {
  $n++
  $s = Resolve-Stock $t
  if ($s) { $t.stock = $s.slug; if (-not $stocks.Contains($s.slug)) { $stocks[$s.slug] = [ordered]@{ slug = $s.slug; name = $s.name } } }
  if (($n % 50) -eq 0) { Log "  $n / $($toProcess.Count)  (matched $($stocks.Count))" }
}

# ---------------------------------------------------------------- 5. prices (Yahoo) - to judge calls
function Get-YahooSeries([string]$sym, [string]$range, [string]$interval, [double]$ttl) {
  # range=max silently downgrades to monthly bars, so long histories use explicit period1/period2
  $q = if ($range -eq 'max') { "period1=946684800&period2=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" } else { "range=$range" }
  $key = if ($range -eq 'max') { "${sym}_since2000_$interval" } else { "${sym}_${range}_$interval" }
  $txt = Get-Cached 'yahoo' $key $ttl "https://query1.finance.yahoo.com/v8/finance/chart/$([Uri]::EscapeDataString($sym))?$q&interval=$interval&includeAdjustedClose=true"
  if (-not $txt) { return $null }
  $r = @(($txt | ConvertFrom-Json).chart.result)[0]
  if (-not $r -or -not $r.timestamp) { return $null }
  $qq = $r.indicators.quote[0]
  $adj = $null; if ($r.indicators.adjclose) { $adj = $r.indicators.adjclose[0].adjclose }
  return @{ meta = $r.meta; ts = @($r.timestamp); close = @($qq.close); high = @($qq.high); low = @($qq.low); adj = $(if ($adj) { @($adj) } else { @($qq.close) }) }
}
function Price-At($ser, [long]$epoch) {
  for ($i = 0; $i -lt $ser.ts.Count; $i++) {
    if ($ser.ts[$i] -ge ($epoch - 3 * 86400) -and $null -ne $ser.close[$i]) { return @{ i = $i; close = $ser.close[$i]; adj = $ser.adj[$i]; ts = $ser.ts[$i] } }
  }
  return $null
}
function Last-Valid($arr) { for ($i = $arr.Count - 1; $i -ge 0; $i--) { if ($null -ne $arr[$i]) { return $arr[$i] } }; return $null }

Log "Fetching Nifty 50 history…"
$nifty = Get-YahooSeries '^NSEI' 'max' '1wk' 20

Log "Fetching prices for $($stocks.Count) companies…"
$priceSeries = @{}
$n = 0
foreach ($s in $stocks.Values) {
  $n++
  $cands = if ($s.slug -match '^\d+$') { @("$($s.slug).BO") } else { @("$($s.slug).NS", "$($s.slug).BO") }
  foreach ($sym in $cands) {
    $ser = Get-YahooSeries $sym 'max' '1wk' 20
    if ($ser -and $ser.ts.Count -gt 2) {
      $priceSeries[$s.slug] = $ser
      $d = Get-YahooSeries $sym '1mo' '1d' 20
      $closes = @(); if ($d) { $closes = @($d.close | Where-Object { $null -ne $_ }) }
      $chg5 = $null; if ($closes.Count -ge 6) { $chg5 = [Math]::Round(($closes[-1] / $closes[-6] - 1) * 100, 1) }
      $px = $ser.meta.regularMarketPrice; if (-not $px) { $px = Last-Valid $ser.close }
      $hiAll = ($ser.high | Where-Object { $null -ne $_ } | Measure-Object -Maximum).Maximum
      $n52 = [Math]::Min(52, $ser.ts.Count)
      $h52 = @($ser.high | Select-Object -Last $n52 | Where-Object { $null -ne $_ })
      $l52 = @($ser.low  | Select-Object -Last $n52 | Where-Object { $null -ne $_ })
      $s['px'] = [ordered]@{
        sym = $sym; price = [Math]::Round([double]$px, 2); chg5d = $chg5
        high52 = $(if ($h52) { [Math]::Round(($h52 | Measure-Object -Maximum).Maximum, 2) } else { $null })
        low52  = $(if ($l52) { [Math]::Round(($l52 | Measure-Object -Minimum).Minimum, 2) } else { $null })
        ath = $(if ($hiAll) { [Math]::Round($hiAll, 2) } else { $null })
      }
      break
    }
  }
  if (($n % 50) -eq 0) { Log "  $n / $($stocks.Count)" }
}

foreach ($t in $toProcess) {
  if (-not $t.stock -or -not $priceSeries.ContainsKey($t.stock)) { continue }
  $ser = $priceSeries[$t.stock]
  $ep = To-Epoch $t.created
  $at = Price-At $ser $ep
  if (-not $at) { continue }
  $lastAdj = Last-Valid $ser.adj
  $years = ($Now - [DateTimeOffset]::FromUnixTimeSeconds($at.ts).UtcDateTime).TotalDays / 365.25
  $ret = ($lastAdj / $at.adj - 1) * 100
  $cagr = $null; if ($years -ge 0.5) { $cagr = ([Math]::Pow($lastAdj / $at.adj, 1 / $years) - 1) * 100 }
  $nRet = $null
  if ($nifty) { $na = Price-At $nifty $ep; if ($na) { $nRet = ((Last-Valid $nifty.close) / $na.close - 1) * 100 } }
  $t['track'] = [ordered]@{
    priceAtPost = [Math]::Round([double]$at.close, 2)
    ret = [Math]::Round($ret, 1)
    cagr = $(if ($null -ne $cagr) { [Math]::Round($cagr, 1) } else { $null })
    years = [Math]::Round($years, 2)
    niftyRet = $(if ($null -ne $nRet) { [Math]::Round($nRet, 1) } else { $null })
    listedLater = (($at.ts - $ep) -gt (21 * 86400))
  }
}

# ---------------------------------------------------------------- 6. write site\data.js
$out = [ordered]@{
  generatedAt = $Now.ToString('o')
  params = [ordered]@{ latest = $Latest; trackTopics = $TrackTopics; minTrackAgeDays = $MinTrackAgeDays; comments = $Comments }
  category = [ordered]@{ id = $CatId; name = 'Stock Opportunities'; url = "$Forum/c/$CatSlug/$CatId" }
  latestIds = @($latestTopics | ForEach-Object { $_.id })
  trackIds = @($trackSet.Values | ForEach-Object { $_.id })
  topics = @($all)
  stocks = $stocks
}
if (-not (Test-Path $SiteDir)) { New-Item -ItemType Directory -Force $SiteDir | Out-Null }
Log "Writing site\data.js…"
$json = $out | ConvertTo-Json -Depth 12 -Compress
[IO.File]::WriteAllText((Join-Path $SiteDir 'data.js'), "window.VP_DATA = $json;", $Utf8)
$withT = @($toProcess | Where-Object { $_.Contains('track') }).Count
Log ("Done. topics={0} processed={1} tickers={2} priced-calls={3}" -f $all.Count, $toProcess.Count, $stocks.Count, $withT)
Log "Open site\index.html in your browser."
