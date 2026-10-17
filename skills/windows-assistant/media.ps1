# Sends Windows media keys. Usage: media.ps1 play|next|prev|stop|volup|voldown|mute [count]
param([Parameter(Mandatory)][ValidateSet("play", "next", "prev", "stop", "volup", "voldown", "mute")][string]$Action,
      [int]$Count = 1)

Add-Type -Namespace Win32 -Name Keys -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
'@

$vk = @{ play = 0xB3; next = 0xB0; prev = 0xB1; stop = 0xB2; volup = 0xAF; voldown = 0xAE; mute = 0xAD }[$Action]
for ($i = 0; $i -lt [Math]::Max(1, $Count); $i++) {
    [Win32.Keys]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)   # key down
    [Win32.Keys]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)   # key up
    Start-Sleep -Milliseconds 40
}
Write-Output "sent $Action x$Count"
