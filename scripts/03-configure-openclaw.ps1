# Merges config\openclaw.template.json into ~/.openclaw/openclaw.json (keeps the gateway token
# and everything else OpenClaw wrote), installs the llama.cpp embedding provider, then prints
# the one interactive step left.
#
#   .\scripts\03-configure-openclaw.ps1                              # menus: MERGEN's language, voice language
#   .\scripts\03-configure-openclaw.ps1 -Language German -Voice en   # no menus (-Voice tr | en | none)
param([string]$Language = "", [string]$Voice = "")

# --- config -----------------------------------------------------------------
$OpenClawConfig    = "$HOME\.openclaw\openclaw.json"
$Template          = Join-Path $PSScriptRoot "..\config\openclaw.template.json"
$LlamaCppProvider  = "@openclaw/llama-cpp-provider@2026.8.35"   # keep in step with the OpenClaw version
$UserName          = $env:USERNAME                                # how MERGEN addresses you; change to your first name
$ProjectsDir       = "$HOME\Documents\GitHub"                     # where hybrid-dev creates projects
$Workspace         = "$HOME\.openclaw\workspace"                  # OpenClaw's agent workspace
# -----------------------------------------------------------------------------
$ErrorActionPreference = "Stop"

if (-not (Test-Path $OpenClawConfig)) { throw "$OpenClawConfig not found. Run 02-install-openclaw.ps1 first." }
Copy-Item $OpenClawConfig "$OpenClawConfig.before-mergen" -Force

# --- language -----------------------------------------------------------------
# MERGEN writes in any language the model handles well; the menu lists common ones, "Other" takes any name.
# Voice (speech in and out) is Turkish or English: those are the two with a tested Whisper + Piper setup here.
. (Join-Path $PSScriptRoot "menu.ps1")
$Languages = @(
    @("Turkish", "Türkçe", "tr"), @("English", "English", "en"), @("German", "Deutsch", "de"), @("French", "Français", "fr"),
    @("Spanish", "Español", "es"), @("Portuguese", "Português", "pt"), @("Italian", "Italiano", "it"), @("Dutch", "Nederlands", "nl"),
    @("Russian", "Русский", "ru"), @("Ukrainian", "Українська", "uk"), @("Polish", "Polski", "pl"), @("Arabic", "العربية", "ar"),
    @("Persian", "فارسی", "fa"), @("Hindi", "हिन्दी", "hi"), @("Japanese", "日本語", "ja"), @("Korean", "한국어", "ko"),
    @("Chinese", "中文", "zh"), @("Indonesian", "Bahasa Indonesia", "id"), @("Vietnamese", "Tiếng Việt", "vi"),
    @("Azerbaijani", "Azərbaycanca", "az"), @("Kazakh", "Қазақша", "kk"), @("Uzbek", "Oʻzbekcha", "uz")
) | ForEach-Object { [pscustomobject]@{ Name = $_[0]; Native = $_[1]; Code = $_[2] } }
if (-not $Language) {
    $rows = @($Languages | ForEach-Object { "{0,-12} {1}" -f $_.Name, $_.Native }) + "Other... (type its name)"
    $i = Select-MenuItem "Which language should MERGEN speak?" $rows 0
    if ($i -lt 0) { Write-Host "Cancelled, nothing changed."; exit 1 }
    $Language = if ($i -lt $Languages.Count) { $Languages[$i].Name } else { Read-Host "Language name, in English (e.g. Swahili)" }
}
$lang = $Languages | Where-Object { $_.Name -eq $Language -or $_.Native -eq $Language -or $_.Code -eq $Language } | Select-Object -First 1
if (-not $lang) { $lang = [pscustomobject]@{ Name = $Language.Trim(); Native = $Language.Trim(); Code = "" } }
if (-not $lang.Name) { throw "No language given." }
if (-not $Voice) {
    if ($lang.Code -in "tr", "en") { $Voice = $lang.Code }
    else {
        $i = Select-MenuItem "Voice (wake word, push-to-talk, spoken replies) works in Turkish or English. Which one?" @("English", "Turkish", "No voice") 0
        $Voice = @("en", "tr", "none")[[math]::Max(0, $i)]
    }
}
if ($Voice -notin "tr", "en", "none") { throw "-Voice must be tr, en or none (got '$Voice')." }
# Read by the voice scripts and the hybrid orchestrator; machine-specific, so not in git.
[ordered]@{ language = $lang.Name; code = $lang.Code; voice = $Voice } | ConvertTo-Json |
    Set-Content (Join-Path $PSScriptRoot "..\config\language.json") -Encoding UTF8
Write-Host "MERGEN's language: $($lang.Name); voice: $Voice"
# -------------------------------------------------------------------------------

# The active Strata model (written by 01-install-strata.ps1) goes into the template.
$active = Get-Content (Join-Path $PSScriptRoot "..\config\active-model.json") -Raw | ConvertFrom-Json
$rendered = Join-Path $env:TEMP "openclaw.template.rendered.json"
(Get-Content $Template -Raw).Replace("{{STRATA_MODEL_ID}}", $active.model_name).Replace("{{STRATA_MODEL_LABEL}}", $active.model) |
    Set-Content $rendered -Encoding UTF8
Write-Host "Strata model: $($active.model_name)"

# Deep merge: objects merge key by key, arrays and values from the template win.
node -e @"
const fs = require('fs');
const [cfgPath, tplPath] = process.argv.slice(1);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { for (const k of Object.keys(b)) a[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return a; };
fs.writeFileSync(cfgPath, JSON.stringify(merge(cfg, tpl), null, 2));
console.log('merged', tplPath, '->', cfgPath);
"@ $OpenClawConfig $rendered

openclaw plugins install $LlamaCppProvider --pin --accept-capabilities

# Local web search: SearXNG in Docker + OpenClaw's official SearXNG plugin (web_search) + the searxng MCP server.
& (Join-Path $PSScriptRoot "start-searxng.ps1")
openclaw plugins install "@openclaw/searxng-plugin@2026.8.35" --pin --accept-capabilities
npm install -g mcp-searxng@2.6.0
$mcpEntry = Join-Path (npm root -g) "mcp-searxng\dist\cli.js"
openclaw mcp add searxng --command (Get-Command node).Source --arg $mcpEntry --env "SEARXNG_URL=http://127.0.0.1:8890" --timeout 60 --parallel

# This repo's skills (personal skills folder, read by OpenClaw) and the local Claude Code wrapper.
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
# Skills and workspace files are templates: {{MERGEN_HOME}}, {{PROJECTS_DIR}}, {{OPENCLAW_WORKSPACE}},
# {{USERPROFILE}}, {{USER_NAME}}, {{LANGUAGE}} and {{LANG_CODE}} are filled in here, so the agent sees your real
# paths, name and language.
function Render-Template([string]$Source, [string]$Target) {
    $text = [IO.File]::ReadAllText($Source, [Text.Encoding]::UTF8)
    $text = $text.Replace("{{MERGEN_HOME}}", "$repo").Replace("{{PROJECTS_DIR}}", $ProjectsDir)
    $text = $text.Replace("{{OPENCLAW_WORKSPACE}}", $Workspace).Replace("{{USERPROFILE}}", $HOME).Replace("{{USER_NAME}}", $UserName)
    $text = $text.Replace("{{LANGUAGE}}", $lang.Name).Replace("{{LANG_CODE}}", $(if ($lang.Code) { $lang.Code } else { "en" }))
    New-Item -ItemType Directory -Force (Split-Path $Target) | Out-Null
    [IO.File]::WriteAllText($Target, $text, (New-Object Text.UTF8Encoding($false)))
}
Get-ChildItem "$repo\skills" -Recurse -File | ForEach-Object {
    $target = Join-Path "$HOME\.agents\skills" $_.FullName.Substring("$repo\skills\".Length)
    if ($_.Extension -in ".md", ".ps1") { Render-Template $_.FullName $target } else { Copy-Item $_.FullName $target -Force }
}
# MERGEN's identity files: only written when missing, so an existing workspace is never overwritten.
foreach ($f in "IDENTITY.md", "SOUL.md", "AGENTS.md") {
    $target = Join-Path $Workspace $f
    if (-not (Test-Path $target)) { Render-Template (Join-Path "$repo\openclaw-workspace" $f) $target }
    else { Write-Host "kept existing $target (to change its language, edit the 'Speak ...' line in SOUL.md)" }
}
New-Item -ItemType Directory -Force "$HOME\.local\bin" | Out-Null
Copy-Item -Path "$repo\scripts\claude-local.cmd" -Destination "$HOME\.local\bin\claude-local.cmd" -Force
openclaw config set skills.entries.coding-agent.enabled true
npm install -g mcporter
openclaw models list

Write-Host @"

One interactive step is left (OpenClaw has no flag for it). Run:

    openclaw configure --section model

  1. Model/auth provider  -> More...  -> type 'llama' -> Local llama.cpp
  2. Auth method          -> Managed local server
  3. 'download Gemma 4 E4B (about 5.0 GB) plus ...'      -> No   (that is a chat model; Strata stays the chat model)
  4. 'download only the local embedding model ... Continue?' -> Yes

Then:

    openclaw gateway restart
    openclaw memory status --index --agent main
    .\scripts\verify.ps1
"@
