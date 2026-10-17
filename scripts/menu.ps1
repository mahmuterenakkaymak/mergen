# Console helpers shared by the setup scripts (dot-source it: . "$PSScriptRoot\menu.ps1").
#   Select-MenuItem: arrow-key menu (Up/Down, Home/End, Enter, Esc) -> chosen index, or -1 on Esc
#   Confirm-Step:    Enter = yes, Esc = no
# Without an interactive console (redirected input, ISE, an AI agent's shell) both fall back to typed answers.

function Test-InteractiveConsole {
    -not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected -and $Host.Name -eq "ConsoleHost"
}

function Select-MenuItem([string]$Title, [string[]]$Items, [int]$Default = 0, [int[]]$Dim = @()) {
    $n = $Items.Count
    # The in-place redraw needs every row on screen; a short window gets the typed fallback instead.
    if (-not (Test-InteractiveConsole) -or $n + 4 -gt [Console]::WindowHeight) {
        Write-Host "`n$Title`n"
        for ($i = 0; $i -lt $n; $i++) { Write-Host ("{0,2}. {1}" -f ($i + 1), $Items[$i]) }
        $answer = Read-Host "`nNumber [Enter = $($Default + 1)]"
        if (-not $answer) { return $Default }
        if ($answer -match '^\d+$' -and [int]$answer -ge 1 -and [int]$answer -le $n) { return [int]$answer - 1 }
        throw "Not a number between 1 and ${n}: '$answer'"
    }
    Write-Host "`n$Title"
    Write-Host "Up/Down to choose, Enter to confirm, Esc to quit.`n"
    # One console row per item (cut to the window width), or the redraw lands on the wrong rows.
    $width = [Console]::WindowWidth - 1
    $rows = foreach ($r in $Items) { if ($r.Length -gt $width - 2) { $r.Substring(0, $width - 5) + "..." } else { $r } }
    # Print once, then redraw in place. The top row is read after printing: at the bottom of the window,
    # printing scrolls the buffer.
    for ($i = 0; $i -lt $n; $i++) { Write-Host "" }
    $top = [Console]::CursorTop - $n
    $index = [math]::Max(0, [math]::Min($Default, $n - 1))
    $cursorWas = [Console]::CursorVisible
    [Console]::CursorVisible = $false
    try {
        while ($true) {
            for ($i = 0; $i -lt $n; $i++) {
                [Console]::SetCursorPosition(0, $top + $i)
                $color = if ($i -eq $index) { "Cyan" } elseif ($Dim -contains $i) { "DarkGray" } else { "Gray" }
                $prefix = if ($i -eq $index) { "> " } else { "  " }
                Write-Host ($prefix + $rows[$i]).PadRight($width) -ForegroundColor $color -NoNewline
            }
            switch ([Console]::ReadKey($true).Key) {
                "UpArrow"   { $index = ($index - 1 + $n) % $n }
                "DownArrow" { $index = ($index + 1) % $n }
                "Home"      { $index = 0 }
                "End"       { $index = $n - 1 }
                "Enter"     { return $index }
                "Escape"    { return -1 }
            }
        }
    } finally {
        [Console]::CursorVisible = $cursorWas
        [Console]::SetCursorPosition(0, $top + $n)
        Write-Host ""
    }
}

function Confirm-Step([string]$Question) {
    if (-not (Test-InteractiveConsole)) {
        $answer = Read-Host "$Question [Y/n]"
        return (-not $answer -or $answer -match '^(y|yes|e|evet)$')
    }
    Write-Host "$Question  Enter = yes, Esc = no" -ForegroundColor Yellow
    while ($true) {
        switch ([Console]::ReadKey($true).Key) {
            "Enter"  { return $true }
            "Escape" { return $false }
        }
    }
}
