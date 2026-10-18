# MERGEN mode panel: the 32 GB card is the layout - one heavy model at a time, each mode drawn at the VRAM it takes.
# Runs switch-mode.ps1 hidden and streams its output into the panel. Also: code-pipeline brain switch, new chat button,
# TR / EN. Look (2026-10-18, taste-skill rules): one accent, sentence case, no icon cards, tone steps instead of lines.
param([string]$Snapshot, [string]$Lang)   # -Snapshot <png>: render once and exit; -Lang tr|en overrides the saved one
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
$Root         = Split-Path $PSScriptRoot -Parent
$Switch       = Join-Path $PSScriptRoot "switch-mode.ps1"
$OpenChat     = Join-Path $PSScriptRoot "open-chat.ps1"
$LogFile      = Join-Path $env:TEMP "mergen-mode-switch.log"
$StrataHealth = "http://127.0.0.1:8080/health"
$UnslothUrl   = "http://127.0.0.1:8888/v1/models"
$BrainFile    = Join-Path $Root "config\hybrid.json"     # read by hybrid_run.py; --brain local on a project still wins
$PanelFile    = Join-Path $Root "config\panel.json"      # panel language
$ProjectsDir  = Join-Path $env:USERPROFILE "Documents\GitHub"   # where pipeline projects live (.hybrid\log.md)
$CardGB       = 32
$Modes = @(@{ Id = "agent"; GB = 31 }, @{ Id = "creative"; GB = 18 }, @{ Id = "free"; GB = 0 })
$Brains = @(@{ Id = "local"; W = 150 }, @{ Id = "cloud"; W = 236 })
$T = @{
    en = @{
        tagline = "One model on the 32 GB card at a time."; inUse = "{0:N1} of {1:N0} GB in use"; temp = "GPU {0} °C"
        vramUnknown = "VRAM unknown"; noSmi = "nvidia-smi unavailable"; on = "on"; off = "off"; running = "Active"
        agent = "Agent"; agentSub = "Qwen3.8 Flash-Next · 256K context · Strata"
        creative = "Creative"; creativeSub = "Qwen3.8 27B + ComfyUI · Unsloth Studio"
        free = "GPU free"; freeSub = "Everything stopped · games, fine-tune, OBS"
        pipeline = "Code pipeline"; local = "Full local"; cloud = "Hybrid (Claude + Mergen)"
        localSays = "Strata plans, reviews and writes - nothing goes to the cloud"
        cloudSays = "Claude plans and reviews, Mergen writes the code"
        building = "building {0} - {1}"; limit = "Claude limit hit at {0}, went local"
        hint = "Pick a mode. Switching takes ~15 s (GPU free) to ~2 min (Agent, cold start)."
        busy = "A switch is already running - wait for it to finish."; switching = "Switching to {0} ..."
        chat = "New chat"; chatOpening = "Opening a new MERGEN chat ..."
        chatFail = "The OpenClaw gateway is not answering - start MERGEN first."
    }
    tr = @{
        tagline = "32 GB kartta aynı anda tek model."; inUse = "{0:N1} / {1:N0} GB kullanımda"; temp = "GPU {0} °C"
        vramUnknown = "VRAM bilinmiyor"; noSmi = "nvidia-smi yok"; on = "açık"; off = "kapalı"; running = "Aktif"
        agent = "Ajan"; agentSub = "Qwen3.8 Flash-Next · 256K bağlam · Strata"
        creative = "Yaratıcı mod"; creativeSub = "Qwen3.8 27B + ComfyUI · Unsloth Studio"
        free = "Kapalı"; freeSub = "Her şey durdu · oyun, fine-tune, OBS"
        pipeline = "Kod pipeline'ı"; local = "Tamamen Yerel"; cloud = "Hibrit (Claude + Mergen)"
        localSays = "Plan, review ve kod Strata'da - buluta hiçbir şey gitmez"
        cloudSays = "Claude planlar ve review eder, kodu Mergen yazar"
        building = "{0} build ediliyor - {1}"; limit = "Claude limiti {0}'de doldu, yerele geçildi"
        hint = "Bir mod seç. Geçiş ~15 sn (Kapalı) ile ~2 dk (Ajan, ilk açılış) sürer."
        busy = "Bir geçiş zaten sürüyor - bitmesini bekle."; switching = "{0} moduna geçiliyor ..."
        chat = "Yeni sohbet"; chatOpening = "Yeni MERGEN sohbeti açılıyor ..."
        chatFail = "OpenClaw gateway cevap vermiyor - önce MERGEN'i başlat."
    }
}
# -----------------------------------------------------------------------------

function Read-Json($path) { try { Get-Content $path -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $null } }
function Write-Json($path, $obj) {
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    [IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Compress))   # UTF-8, no BOM
}
$script:lang = if ($Lang) { $Lang } elseif ((Read-Json $PanelFile).lang) { (Read-Json $PanelFile).lang }
               elseif ((Read-Json (Join-Path $Root "config\language.json")).language -eq "English") { "en" } else { "tr" }
function S($key) { $T[$script:lang][$key] }

function Hex($h) { [Drawing.ColorTranslator]::FromHtml($h) }
# One ground, one ink, one accent; surfaces step in tone. Amber only for a near-full card.
$C = @{ Bg = Hex "#0A0D13"; Raise = Hex "#131925"; Raise2 = Hex "#1A2231"; Ink = Hex "#EEF2F8"; Soft = Hex "#9AA6B8"
        Accent = Hex "#5CC8FF"; OnAccent = Hex "#06121C"; Track = Hex "#222B3B"; Warn = Hex "#F5A524" }
function Font($size, $style = "Regular", $family = "Segoe UI") { New-Object Drawing.Font($family, $size, [Drawing.FontStyle]::$style) }
function Pill($ctrl) {   # fully round ends - the one corner style of the panel
    $p = New-Object Drawing.Drawing2D.GraphicsPath; $w = $ctrl.Width; $h = $ctrl.Height
    $p.AddArc(0, 0, $h, $h, 90, 180); $p.AddArc($w - $h, 0, $h, $h, 270, 180); $p.CloseFigure()
    $ctrl.Region = New-Object Drawing.Region($p)
}
function Label($text, $font, $color, $x, $y, $w = 300, $h = 24) {
    $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Font = $font; $l.ForeColor = $color
    $l.BackColor = [Drawing.Color]::Transparent; $l.Location = New-Object Drawing.Point($x, $y); $l.Size = New-Object Drawing.Size($w, $h); $l
}
function Box($color, $x, $y, $w, $h) {
    $b = New-Object Windows.Forms.Panel; $b.BackColor = $color
    $b.Location = New-Object Drawing.Point($x, $y); $b.Size = New-Object Drawing.Size($w, $h); $b
}
function Button($x, $y, $w, $h, $font) {
    $b = Label "" $font $C.Soft $x $y $w $h; $b.TextAlign = "MiddleCenter"; $b.BackColor = $C.Raise
    $b.Cursor = [Windows.Forms.Cursors]::Hand; $form.Controls.Add($b); Pill $b; $b
}

# --- window -------------------------------------------------------------------
$form = New-Object Windows.Forms.Form
$form.Text = "MERGEN · AI Modes"; $form.ClientSize = New-Object Drawing.Size(720, 640)
$form.BackColor = $C.Bg; $form.StartPosition = "CenterScreen"; $form.FormBorderStyle = "FixedSingle"; $form.MaximizeBox = $false
$form.Add_HandleCreated({ $on = 1; [void][Ui.Dwm]::DwmSetWindowAttribute($form.Handle, 20, [ref]$on, 4) })   # dark title bar

$form.Controls.Add((Label "MERGEN" (Font 30 Bold) $C.Ink 24 14 260 54))
$tagline = Label "" (Font 11) $C.Soft 28 68 330 24; $form.Controls.Add($tagline)
$clock = Label "" (Font 10) $C.Soft 440 70 252 22; $clock.TextAlign = "MiddleRight"; $form.Controls.Add($clock)
# the panel's one primary action, then the language switch in the top right
$chatBtn = Button 412 24 168 38 (Font 11 Bold)
$chatBtn.BackColor = $C.Accent; $chatBtn.ForeColor = $C.OnAccent
$chatBtn.Add_Click({ Open-Chat })
$script:langBtns = @{}
$lx = 590
foreach ($l in @("tr", "en")) {
    $b = Button $lx 28 50 30 (Font 9.5 Bold); $b.Text = $l.ToUpperInvariant()
    $id = $l; $b.Add_Click({ Set-Lang $id }.GetNewClosure())
    $script:langBtns[$l] = $b; $lx += 54
}

# --- live card: the dominant thing ------------------------------------------------
$vramBig = Label "" (Font 24 Bold) $C.Ink 24 108 420 44; $form.Controls.Add($vramBig)
$tempText = Label "" (Font 11) $C.Soft 440 122 252 24; $tempText.TextAlign = "MiddleRight"; $form.Controls.Add($tempText)
$track = Box $C.Track 28 158 664 16; $form.Controls.Add($track); Pill $track
$fill = Box $C.Accent 0 0 0 16; $track.Controls.Add($fill)
$services = Label "" (Font 10.5) $C.Soft 28 182 664 24; $form.Controls.Add($services)

# --- modes: rows drawn to the card's scale ------------------------------------------
$script:rows = @{}
$y = 222
foreach ($m in $Modes) {
    $row = Box $C.Raise 24 $y 672 72
    $title = Label "" (Font 15 Bold) $C.Ink 20 10 220 30; $row.Controls.Add($title)
    $sub = Label "" (Font 10) $C.Soft 22 42 340 22; $row.Controls.Add($sub)
    $state = Label "" (Font 10 Bold) $C.Accent 236 17 90 22; $row.Controls.Add($state); $state.BringToFront()   # sits over the wide title label
    # footprint: the mode's share of the 32 GB card, same scale as the live bar above
    $foot = Box $C.Track 370 30 230 12; $row.Controls.Add($foot); Pill $foot
    $used = Box $C.Soft 0 0 ([int](230 * $m.GB / $CardGB)) 12; $foot.Controls.Add($used)
    $gbText = Label "~$($m.GB) GB" (Font 10.5 Bold) $C.Ink 606 25 60 22; $gbText.TextAlign = "MiddleRight"; $row.Controls.Add($gbText)
    if (-not $m.GB) { $gbText.Text = "0 GB" }

    $id = $m.Id
    $click = { Start-Switch $id }.GetNewClosure()
    $enter = { if ($script:active -ne $id) { $row.BackColor = $C.Raise2 } }.GetNewClosure()
    $leave = { if (-not $row.ClientRectangle.Contains($row.PointToClient([Windows.Forms.Cursor]::Position))) { Paint-Rows } }.GetNewClosure()
    foreach ($ctl in @($row) + @($row.Controls) + @($foot.Controls)) {
        $ctl.Add_Click($click); $ctl.Add_MouseEnter($enter); $ctl.Add_MouseLeave($leave); $ctl.Cursor = [Windows.Forms.Cursors]::Hand
    }
    $form.Controls.Add($row)
    $script:rows[$id] = @{ Row = $row; Title = $title; Sub = $sub; State = $state; Used = $used }
    $y += 80
}

# --- code pipeline brain switch -----------------------------------------------------
$pipeLabel = Label "" (Font 12 Bold) $C.Ink 28 476 150 28; $form.Controls.Add($pipeLabel)
$script:brainBtns = @{}
$bx = 182
foreach ($b in $Brains) {
    $btn = Button $bx 472 $b.W 36 (Font 10.5 Bold)
    $id = $b.Id; $btn.Add_Click({ Set-Brain $id }.GetNewClosure())
    $script:brainBtns[$id] = $btn; $bx += $b.W + 6
}
$brainStatus = Label "" (Font 10) $C.Soft 28 514 664 22; $form.Controls.Add($brainStatus)

# --- switch log (real command output, so monospace) ----------------------------------
$logBg = Box $C.Raise 24 548 672 76; $form.Controls.Add($logBg)
$log = New-Object Windows.Forms.Label; $log.BackColor = $C.Raise; $log.ForeColor = $C.Soft
$log.Font = Font 9 Regular "Consolas"; $log.Location = New-Object Drawing.Point(16, 10); $log.Size = New-Object Drawing.Size(644, 58)
$logBg.Controls.Add($log)

# --- behaviour --------------------------------------------------------------------
$script:job = $null
$script:active = ""
function Apply-Lang {
    $tagline.Text = S "tagline"; $chatBtn.Text = S "chat"; $pipeLabel.Text = S "pipeline"
    foreach ($id in $script:rows.Keys) { $script:rows[$id].Title.Text = S $id; $script:rows[$id].Sub.Text = S "${id}Sub" }
    foreach ($id in $script:brainBtns.Keys) { $script:brainBtns[$id].Text = S $id }
    foreach ($l in $script:langBtns.Keys) {
        $on = $l -eq $script:lang
        $script:langBtns[$l].BackColor = if ($on) { $C.Raise2 } else { $C.Bg }
        $script:langBtns[$l].ForeColor = if ($on) { $C.Ink } else { $C.Soft }
    }
    if (-not (Test-Path $LogFile) -or -not $script:job) { $log.Text = S "hint" }
}
function Set-Lang($l) { $script:lang = $l; Write-Json $PanelFile @{ lang = $l }; Apply-Lang; Refresh }
function Open-Chat {
    $log.ForeColor = $C.Ink; $log.Text = S "chatOpening"; $form.Refresh()
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $OpenChat 2>&1
    if ($LASTEXITCODE -ne 0) { $log.Text = S "chatFail" } else { $log.Text = "$(S 'chatOpening')`r`n$out" }
}
function Start-Switch($mode) {
    if ($script:job -and -not $script:job.HasExited) { $log.Text = S "busy"; return }
    Set-Content $LogFile ((S "switching") -f (S $mode)) -Encoding UTF8
    $script:job = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        "& '$Switch' -Mode $mode *>&1 | Out-File -FilePath '$LogFile' -Append -Encoding utf8")
    $log.ForeColor = $C.Ink
}
function Test-Up($url) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $url | Out-Null; $true }
    catch { $null -ne $_.Exception.Response }        # 401 without a key still means the server is up
}
function Paint-Rows {
    foreach ($id in $script:rows.Keys) {
        $k = $script:rows[$id]; $on = $id -eq $script:active
        $k.Row.BackColor = if ($on) { $C.Raise2 } else { $C.Raise }
        $k.State.Text = if ($on) { S "running" } else { "" }
        $k.State.Left = $k.Title.Left + $k.Title.PreferredWidth + 10   # right after the mode name
        $k.Used.BackColor = if ($on) { $C.Accent } else { $C.Soft }
    }
}
function Get-Brain { $b = (Read-Json $BrainFile).brain; if ($b) { $b } else { "cloud" } }
function Set-Brain($brain) { Write-Json $BrainFile @{ brain = $brain }; Refresh-Brain }
function Refresh-Brain {
    $brain = Get-Brain
    foreach ($id in $script:brainBtns.Keys) {
        $btn = $script:brainBtns[$id]; $on = $id -eq $brain
        $btn.BackColor = if ($on) { $C.Accent } else { $C.Raise }
        $btn.ForeColor = if ($on) { $C.OnAccent } else { $C.Soft }
    }
    # Status: what the switch means, a running build (newest pipeline log) and a Claude limit hit in the last 24 h.
    $parts = @(if ($brain -eq "local") { S "localSays" } else { S "cloudSays" })
    $logs = Get-ChildItem $ProjectsDir -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Get-Item (Join-Path $_.FullName ".hybrid\log.md") -ErrorAction SilentlyContinue } |
        Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-24) } | Sort-Object LastWriteTime -Descending
    if ($logs) {
        $newest = $logs[0]; $project = $newest.Directory.Parent.Name
        $last = Get-Content $newest.FullName -Tail 1 -Encoding UTF8
        if ($newest.LastWriteTime -gt (Get-Date).AddMinutes(-15) -and $last -notmatch "\| done: ") {
            $step = ($last -split "\|", 3)[2].Trim(); if ($step.Length -gt 40) { $step = $step.Substring(0, 40) + "..." }
            $parts += (S "building") -f $project, $step
        }
        $limit = $logs | ForEach-Object { Select-String -Path $_.FullName -Pattern "usage limit hit" -SimpleMatch } |
            Select-Object -Last 1
        if ($limit) { $parts += (S "limit") -f ($limit.Line -split ' ')[1].Substring(0, 5) }
    }
    $brainStatus.Text = $parts -join "   ·   "
}

function Refresh {
    $culture = if ($script:lang -eq "tr") { "tr-TR" } else { "en-GB" }
    $clock.Text = (Get-Date).ToString("HH:mm  ·  d MMM", [Globalization.CultureInfo]::GetCultureInfo($culture))
    $strata = $false; try { $strata = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $StrataHealth).Content -match '"loaded": true' } catch {}
    $unsloth = Test-Up $UnslothUrl
    $comfy = [bool](Get-Process ComfyUI -ErrorAction SilentlyContinue)
    $script:active = if ($strata) { "agent" } elseif ($unsloth -or $comfy) { "creative" } else { "free" }
    Paint-Rows
    try {
        $v = (nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits) -split ",\s*"
        $used = [double]$v[0]; $total = [double]$v[1]
        $fill.Width = [int]($track.Width * $used / $total)
        $fill.BackColor = if ($used / $total -gt 0.9) { $C.Warn } else { $C.Accent }
        $vramBig.Text = (S "inUse") -f ($used / 1024), ($total / 1024)
        $tempText.Text = (S "temp") -f $v[2]
    } catch { $vramBig.Text = S "vramUnknown"; $tempText.Text = S "noSmi" }
    $dot = { param($up) if ($up) { [string][char]0x25CF + " " + (S "on") } else { [string][char]0x25CB + " " + (S "off") } }
    $services.Text = "Strata $(& $dot $strata)      Unsloth Studio $(& $dot $unsloth)      ComfyUI $(& $dot $comfy)"
    if ($script:job -and (Test-Path $LogFile)) {
        $lines = Get-Content $LogFile -Tail 4 -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_.Trim() }
        if ($lines) { $log.Text = ($lines -join "`r`n") }
    }
    if ($script:job -and $script:job.HasExited) { $log.ForeColor = $C.Soft }
    Refresh-Brain
}

Apply-Lang
if ($Snapshot) {   # render once to a PNG and exit (for docs/tests)
    $form.Show(); Refresh; [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 300; [Windows.Forms.Application]::DoEvents()
    $bmp = New-Object Drawing.Bitmap($form.Width, $form.Height)
    $form.DrawToBitmap($bmp, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $bmp.Save($Snapshot, [Drawing.Imaging.ImageFormat]::Png); $form.Close(); return
}
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 3000; $timer.Add_Tick({ Refresh }); $timer.Start()
$form.Add_Shown({ [void][Ui.Dwm]::ShowWindow($form.Handle, 9); $form.Activate(); Refresh })   # 9 = SW_RESTORE
[void]$form.ShowDialog()
