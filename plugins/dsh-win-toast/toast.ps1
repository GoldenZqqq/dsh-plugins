param(
    [string]$Kind = 'info',
    [string]$Title = 'DSH',
    [string]$Body = '',
    [string]$Launch = ''
)

# dsh-win-toast helper: show a Windows toast (WinRT) with balloon-tip fallback.
# Keep this file pure ASCII: all user-facing text arrives via parameters
# (the command line is UTF-16, so CJK text is safe; file content is not).

$ErrorActionPreference = 'Stop'

function ConvertTo-ToastXmlSafe([string]$s) {
    if ($null -eq $s) { return '' }
    $s = $s -replace '&', '&amp;'
    $s = $s -replace '<', '&lt;'
    $s = $s -replace '>', '&gt;'
    $s = $s -replace '"', '&quot;'
    $s = $s -replace "'", '&apos;'
    return $s
}

function Show-Balloon([string]$Title, [string]$Body, [bool]$IsError) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Visible = $true
    $tipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    if ($IsError) { $tipIcon = [System.Windows.Forms.ToolTipIcon]::Error }
    $icon.ShowBalloonTip(6000, $Title, $Body, $tipIcon)
    Start-Sleep -Seconds 7
    $icon.Visible = $false
    $icon.Dispose()
}

try {
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

    # Borrow the well-known AppUserModelID of Windows PowerShell so the toast
    # is attributed to a Start-Menu-registered app (no registration needed).
    $aumid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

    $launchAttr = ''
    if ($Launch) { $launchAttr = ' activationType="protocol" launch="' + (ConvertTo-ToastXmlSafe $Launch) + '"' }

    $safeTitle = ConvertTo-ToastXmlSafe $Title
    $safeBody = ConvertTo-ToastXmlSafe $Body

    $xmlText = '<toast' + $launchAttr + '><visual><binding template="ToastGeneric"><text>' + $safeTitle + '</text><text>' + $safeBody + '</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>'

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($xmlText)
    $toast = New-Object Windows.UI.Notifications.ToastNotification -ArgumentList $xml
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
    exit 0
} catch {
    try {
        Show-Balloon -Title $Title -Body $Body -IsError:($Kind -eq 'error')
        exit 0
    } catch {
        exit 1
    }
}
