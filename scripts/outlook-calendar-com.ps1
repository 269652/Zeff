<#
  Zeff's "Outlook on this PC" calendar reader: every calendar of the classic Outlook that is installed
  here (its mailboxes' calendars, iCloud / subscribed internet calendars), read through Outlook's own
  COM interface. READ-ONLY: nothing is created, changed or deleted; Outlook has to be installed (it is
  started if it isn't running). Windows only.

  Prints one JSON document to stdout:
    { "events": [ Graph-shaped events, times in LOCAL wall-clock time ],
      "calendars": [ { "name": "<store> / <calendar>", "count": n, "excluded": bool } ] }

  Usage (Zeff runs it):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\outlook-calendar-com.ps1 -From 2026-10-01 -To 2026-12-31 [-Exclude "Feiertage;Privat"] [-ListOnly]
  -Exclude: calendars whose "<store> / <calendar>" name contains one of these words (separated by ;) are left out.
  -ListOnly: only the calendars' names, no appointments.
#>
param([string]$From, [string]$To, [string]$Exclude = "", [string]$TimeZone = "", [switch]$ListOnly)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Late-bound COM (works with 32- and 64-bit Outlook; the early-bound type library often isn't registered for PowerShell).
$T = [System.__ComObject]
$BF = [Reflection.BindingFlags]
# The leading comma keeps PowerShell from unrolling COM collections.
function P($o, $n) { ,$T.InvokeMember($n, $BF::GetProperty, $null, $o, $null) }
function PI($o, $n, $i) { ,$T.InvokeMember($n, $BF::GetProperty, $null, $o, @($i)) }
function M($o, $n, $a) { ,$T.InvokeMember($n, $BF::InvokeMethod, $null, $o, $a) }
function S($o, $n, $v) { [void]$T.InvokeMember($n, $BF::SetProperty, $null, $o, @($v)) }

$ci = [Globalization.CultureInfo]::InvariantCulture
$fromDt = if ($From) { [datetime]::ParseExact($From, "yyyy-MM-dd", $ci) } else { (Get-Date).Date.AddDays(-30) }
$toDt = if ($To) { [datetime]::ParseExact($To, "yyyy-MM-dd", $ci).AddDays(1) } else { (Get-Date).Date.AddDays(90) }
$restrict = "[Start] <= '" + $toDt.ToString("MM/dd/yyyy HH:mm", $ci) + "' AND [End] >= '" + $fromDt.ToString("MM/dd/yyyy HH:mm", $ci) + "'"
$busy = @("free", "tentative", "busy", "oof", "workingElsewhere")
$resp = @("none", "organizer", "tentativelyAccepted", "accepted", "declined", "notResponded")
$sens = @("normal", "personal", "private", "confidential")
$excl = @($Exclude -split ";" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$tz = if ($TimeZone) { $TimeZone } else { [TimeZoneInfo]::Local.Id }

$ol = New-Object -ComObject Outlook.Application
$ns = M $ol "GetNamespace" @("MAPI")
$events = New-Object System.Collections.ArrayList
$cals = New-Object System.Collections.ArrayList

# Every folder that holds appointments (DefaultItemType 1: olAppointmentItem), depth first.
function Find-Calendars($folder, $storeName) {
  $kids = P $folder "Folders"
  $n = [int](P $kids "Count")
  for ($i = 1; $i -le $n; $i++) {
    $f = PI $kids "Item" $i
    if ([int](P $f "DefaultItemType") -eq 1) { [pscustomobject]@{ Folder = $f; Name = [string](P $f "Name"); Store = $storeName } }
    Find-Calendars $f $storeName
  }
}

$stores = P $ns "Stores"
$storeCount = [int](P $stores "Count")
for ($si = 1; $si -le $storeCount; $si++) {
  $store = PI $stores "Item" $si
  $storeName = [string](P $store "DisplayName")
  $root = M $store "GetRootFolder" $null
  foreach ($c in @(Find-Calendars $root $storeName)) {
    $label = "$($c.Store) / $($c.Name)"
    $skip = [bool]($excl | Where-Object { $label -like "*$_*" })
    if ($ListOnly -or $skip) { [void]$cals.Add([ordered]@{ name = $label; count = 0; excluded = $skip }); continue }
    $items = P $c.Folder "Items"
    S $items "IncludeRecurrences" $true
    [void](M $items "Sort" @("[Start]"))
    $found = M $items "Restrict" @($restrict)
    $n = 0; $seen = 0
    $a = M $found "GetFirst" $null
    while ($a -ne $null -and $seen -lt 5000) {
      $seen++
      try {
        $s = [datetime](P $a "Start"); $e = [datetime](P $a "End")
        if ($s -lt $toDt -and $e -gt $fromDt) {
          $loc = [string](P $a "Location")
          $orgName = $null; $orgAddr = $null
          try { $o = M $a "GetOrganizer" $null; if ($o) { $orgName = [string](P $o "Name"); $orgAddr = [string](P $o "Address") } } catch {}
          $ms = [int](P $a "MeetingStatus")
          # The description: the body as plain text, line breaks kept, at most 4000 characters.
          $body = ([string](P $a "Body")) -replace "`r`n?", "`n" -replace "(\n\s*){3,}", "`n`n"
          $body = $body.Trim(); if ($body.Length -gt 4000) { $body = $body.Substring(0, 4000) }
          [void]$events.Add([ordered]@{
            bodyPreview = $body
            id = ([string](P $a "EntryID")) + "@" + $s.ToString("yyyyMMddHHmm")
            iCalUId = [string](P $a "GlobalAppointmentID")
            subject = [string](P $a "Subject")
            start = [ordered]@{ dateTime = $s.ToString("yyyy-MM-ddTHH:mm:ss"); timeZone = $tz }
            end = [ordered]@{ dateTime = $e.ToString("yyyy-MM-ddTHH:mm:ss"); timeZone = $tz }
            isAllDay = [bool](P $a "AllDayEvent")
            isCancelled = ($ms -eq 5 -or $ms -eq 7)
            showAs = $busy[[int](P $a "BusyStatus")]
            responseStatus = [ordered]@{ response = $resp[[int](P $a "ResponseStatus")] }
            sensitivity = $sens[[int](P $a "Sensitivity")]
            isOnlineMeeting = ($loc -match "Teams|Zoom|Meet")
            organizer = if ($orgName -or $orgAddr) { [ordered]@{ emailAddress = [ordered]@{ name = $orgName; address = $orgAddr } } } else { $null }
            location = [ordered]@{ displayName = $loc }
          })
          $n++
        }
      } catch {}
      $a = M $found "GetNext" $null
    }
    [void]$cals.Add([ordered]@{ name = $label; count = $n; excluded = $false })
  }
}
[Console]::Out.Write(([ordered]@{ events = @($events); calendars = @($cals) } | ConvertTo-Json -Depth 8 -Compress))
