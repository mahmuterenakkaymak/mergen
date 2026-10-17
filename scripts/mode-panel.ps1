# MERGEN mode panel: dark, live-status switcher for the three GPU modes.
# Runs switch-mode.ps1 hidden and streams its output into the panel.
param([string]$Snapshot)   # optional: save a PNG of the panel and exit
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Ui -Name Dwm -MemberDefinition @'
[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(System.IntPtr hwnd, int attr, ref int value, int size);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hwnd, int cmd);
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
'@
# Hide our own console; launchers can then start this script normally (a -WindowStyle Hidden start also hides the form).
[void][Ui.Dwm]::ShowWindow([Ui.Dwm]::GetConsoleWindow(), 0)
[Windows.Forms.Application]::EnableVisualStyles()

# --- config -----------------------------------------------------------------
$Switch       = Join-Path $PSScriptRoot "switch-mode.ps1"
$LogFile      = Join-Path $env:TEMP "mergen-mode-switch.log"
$StrataHealth = "http://127.0.0.1:8080/health"
$UnslothUrl   = "http://127.0.0.1:8888/v1/models"
$Modes = @(
    @{ Id = "agent";    Title = "Agent";    Sub = "Qwen3.8 Flash-Next · 256K"; Note = "Strata · ~31 GB VRAM";    Icon = [char]0xE99A; Accent = "#22C55E" },
    @{ Id = "creative"; Title = "Creative"; Sub = "Qwen3.8 27B + ComfyUI";     Note = "Unsloth Studio · ~18 GB"; Icon = [char]0xE790; Accent = "#A855F7" },
    @{ Id = "free";     Title = "GPU Free"; Sub = "All AI stopped";            Note = "Games · fine-tune · OBS"; Icon = [char]0xE7FC; Accent = "#64748B" }
)
# -----------------------------------------------------------------------------

function Hex($h) { [Drawing.ColorTranslator]::FromHtml($h) }
$C = @{ Bg = Hex "#0B0F17"; Card = Hex "#141A26"; CardHover = Hex "#1B2333"; Text = Hex "#E6EDF7"; Muted = Hex "#8A97AB"; Track = Hex "#232C3D"; Cyan = Hex "#38BDF8"; Amber = Hex "#F59E0B" }
$iconFont = if ((New-Object Drawing.Text.InstalledFontCollection).Families.Name -contains "Segoe Fluent Icons") { "Segoe Fluent Icons" } else { "Segoe MDL2 Assets" }
function Font($size, $style = "Regular", $family = "Segoe UI") { New-Object Drawing.Font($family, $size, [Drawing.FontStyle]::$style) }
function Round($ctrl, $r) {
    $p = New-Object Drawing.Drawing2D.GraphicsPath; $w = $ctrl.Width; $h = $ctrl.Height; $d = $r * 2
    $p.AddArc(0, 0, $d, $d, 180, 90); $p.AddArc($w - $d, 0, $d, $d, 270, 90)
    $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90); $p.AddArc(0, $h - $d, $d, $d, 90, 90); $p.CloseFigure()
    $ctrl.Region = New-Object Drawing.Region($p)
}
function Label($text, $font, $color, $x, $y, $w = 300, $h = 24) {
    $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Font = $font; $l.ForeColor = $color
    $l.BackColor = [Drawing.Color]::Transparent; $l.Location = New-Object Drawing.Point($x, $y); $l.Size = New-Object Drawing.Size($w, $h); $l
}

# --- window -------------------------------------------------------------------
$form = New-Object Windows.Forms.Form
$form.Text = "MERGEN · AI Modes"; $form.ClientSize = New-Object Drawing.Size(720, 476)
$form.BackColor = $C.Bg; $form.StartPosition = "CenterScreen"; $form.FormBorderStyle = "FixedSingle"; $form.MaximizeBox = $false
$form.Add_HandleCreated({ $on = 1; [void][Ui.Dwm]::DwmSetWindowAttribute($form.Handle, 20, [ref]$on, 4) })   # dark title bar

$form.Controls.Add((Label "MERGEN" (Font 22 Bold) $C.Text 28 16 200 42))
$form.Controls.Add((Label "Local AI · GPU modes" (Font 10) $C.Muted 30 58 300 22))
$clock = Label "" (Font 10) $C.Muted 500 30 190 22; $clock.TextAlign = "MiddleRight"; $form.Controls.Add($clock)

# --- mode cards -----------------------------------------------------------------
$script:cards = @{}
$x = 28
foreach ($m in $Modes) {
    $card = New-Object Windows.Forms.Panel
    $card.Size = New-Object Drawing.Size(212, 170); $card.Location = New-Object Drawing.Point($x, 96); $card.BackColor = $C.Card
    $accent = Hex $m.Accent
    $bar = New-Object Windows.Forms.Panel; $bar.Size = New-Object Drawing.Size(212, 5); $bar.Location = New-Object Drawing.Point(0, 0); $bar.BackColor = $C.Card
    $card.Controls.Add($bar)
    $card.Controls.Add((Label ([string]$m.Icon) (Font 22 Regular $iconFont) $accent 16 20 50 40))
    $card.Controls.Add((Label $m.Title (Font 15 Bold) $C.Text 16 66 190 30))
    $card.Controls.Add((Label $m.Sub (Font 9.5) $C.Text 18 98 190 20))
    $card.Controls.Add((Label $m.Note (Font 9) $C.Muted 18 120 190 20))
    $state = Label "" (Font 9 Bold) $accent 18 142 190 20; $card.Controls.Add($state)

    $id = $m.Id
    $click = { Start-Switch $id }.GetNewClosure()
    $enter = { $card.BackColor = $C.CardHover }.GetNewClosure()
    $leave = { if (-not $card.ClientRectangle.Contains($card.PointToClient([Windows.Forms.Cursor]::Position))) { $card.BackColor = $C.Card } }.GetNewClosure()
    foreach ($ctl in @($card) + @($card.Controls)) { $ctl.Add_Click($click); $ctl.Add_MouseEnter($enter); $ctl.Add_MouseLeave($leave); $ctl.Cursor = [Windows.Forms.Cursors]::Hand }
    $form.Controls.Add($card); Round $card 14
    $script:cards[$id] = @{ Card = $card; Bar = $bar; State = $state; Accent = $accent }
    $x += 228
}

# --- live status ------------------------------------------------------------------
$form.Controls.Add((Label "VRAM" (Font 9 Bold) $C.Muted 30 286 60 20))
$vramText = Label "" (Font 9) $C.Text 410 286 280 20; $vramText.TextAlign = "MiddleRight"; $form.Controls.Add($vramText)
$track = New-Object Windows.Forms.Panel; $track.Size = New-Object Drawing.Size(660, 10); $track.Location = New-Object Drawing.Point(30, 310)
$track.BackColor = $C.Track; $form.Controls.Add($track); Round $track 5
$fill = New-Object Windows.Forms.Panel; $fill.Size = New-Object Drawing.Size(0, 10); $fill.BackColor = $C.Cyan; $track.Controls.Add($fill)
$services = Label "" (Font 9.5) $C.Muted 30 330 660 22; $form.Controls.Add($services)

$logBg = New-Object Windows.Forms.Panel; $logBg.BackColor = $C.Card; $logBg.Location = New-Object Drawing.Point(30, 362); $logBg.Size = New-Object Drawing.Size(660, 96)
$log = New-Object Windows.Forms.Label; $log.BackColor = $C.Card; $log.ForeColor = $C.Muted
$log.Font = Font 9 Regular "Consolas"; $log.Location = New-Object Drawing.Point(14, 10); $log.Size = New-Object Drawing.Size(632, 78)
$log.Text = "Select a mode. Switching takes ~15 s (free) to ~2 min (agent, cold start)."
$logBg.Controls.Add($log); $form.Controls.Add($logBg); Round $logBg 12

# --- behaviour --------------------------------------------------------------------
$script:job = $null
function Start-Switch($mode) {
    if ($script:job -and -not $script:job.HasExited) { $log.Text = "A switch is already running - wait for it to finish."; return }
    Set-Content $LogFile "Switching to $mode ..." -Encoding UTF8
    $script:job = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "& '$Switch' -Mode $mode *>&1 | Out-File -FilePath '$LogFile' -Append -Encoding utf8")
    $log.ForeColor = $C.Text
}
function Test-Up($url) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $url | Out-Null; $true }
    catch { $null -ne $_.Exception.Response }        # 401 without a key still means the server is up
}

function Refresh {
    $clock.Text = (Get-Date).ToString("HH:mm  ·  dd MMM")
    $strata = $false; try { $strata = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $StrataHealth).Content -match '"loaded": true' } catch {}
    $unsloth = Test-Up $UnslothUrl
    $comfy = [bool](Get-Process ComfyUI -ErrorAction SilentlyContinue)
    $active = if ($strata) { "agent" } elseif ($unsloth -or $comfy) { "creative" } else { "free" }
    foreach ($id in $script:cards.Keys) {
        $k = $script:cards[$id]; $on = $id -eq $active
        $k.Bar.BackColor = if ($on) { $k.Accent } else { $C.Card }
        $k.State.Text = if ($on) { [string][char]0x25CF + "  ACTIVE" } else { "" }
    }
    try {
        $v = (nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits) -split ",\s*"
        $used = [double]$v[0]; $total = [double]$v[1]
        $fill.Width = [int]($track.Width * $used / $total)
        $fill.BackColor = if ($used / $total -gt 0.9) { $C.Amber } else { $C.Cyan }
        $vramText.Text = "{0:N1} / {1:N0} GB   ·   {2} °C" -f ($used / 1024), ($total / 1024), $v[2]
    } catch { $vramText.Text = "nvidia-smi unavailable" }
    $on = [string][char]0x25CF; $off = [string][char]0x25CB
    $services.Text = "Strata $(if ($strata) {"$on on"} else {"$off off"})      Unsloth Studio $(if ($unsloth) {"$on on"} else {"$off off"})      ComfyUI $(if ($comfy) {"$on on"} else {"$off off"})"
    if (Test-Path $LogFile) {
        $lines = Get-Content $LogFile -Tail 5 -ErrorAction SilentlyContinue | Where-Object { $_.Trim() }
        if ($lines) { $log.Text = ($lines -join "`r`n") }
    }
    if ($script:job -and $script:job.HasExited) { $log.ForeColor = $C.Muted }
}

if ($Snapshot) {   # render once to a PNG and exit (for docs/tests)
    $form.Show(); Refresh; [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 300; [Windows.Forms.Application]::DoEvents()
    $bmp = New-Object Drawing.Bitmap($form.Width, $form.Height)
    $form.DrawToBitmap($bmp, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $bmp.Save($Snapshot, [Drawing.Imaging.ImageFormat]::Png); $form.Close(); return
}
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 3000; $timer.Add_Tick({ Refresh }); $timer.Start()
$form.Add_Shown({ [void][Ui.Dwm]::ShowWindow($form.Handle, 9); $form.Activate(); Refresh })   # 9 = SW_RESTORE
[void]$form.ShowDialog()
