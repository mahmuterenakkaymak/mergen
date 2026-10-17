@echo off
rem summarize (summarize.sh) on the local Strata model. The OpenAI variables are set only for this process,
rem so other programs that use the OpenAI SDK are not redirected to Strata.
rem Usage: summarize-local <url|file|youtube link> [--length short|medium|long] [--lang tr]
setlocal
set "OPENAI_BASE_URL=http://127.0.0.1:8080/v1"
set "OPENAI_API_KEY=strata-local"
summarize %* --model openai/strata
