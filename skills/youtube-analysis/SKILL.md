---
name: youtube-analysis
description: Analyze YouTube videos and channels locally - transcripts, summaries, video stats (views, likes, duration, upload date), a channel's recent videos and what performs best, and topic/script ideas for the user's own channel. Uses yt-dlp and summarize-local (no API keys). Use for "bu videoyu özetle", "kanalı analiz et", "hangi videolar tuttu", "video fikri".
metadata:
  {
    "openclaw": { "emoji": "📺", "requires": { "bins": ["yt-dlp", "summarize-local"] } }
  }
---

# YouTube analysis (local, no API key)

If the user has their own channel, ask for its handle and topic once when a task needs it. Reply in Turkish.
Run commands through `exec`. Write long outputs to files in the workspace, not into the chat.

## One video

```powershell
# metadata as JSON (title, channel, duration, view_count, like_count, comment_count, upload_date, tags, chapters)
yt-dlp --skip-download --dump-single-json "<url>" > video.json
# transcript (auto or manual subtitles, Turkish first, then English) as plain .vtt
yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "tr,en" --sub-format vtt -o "sub.%(ext)s" "<url>"
# summary with the local model (Strata); works on YouTube links directly
summarize-local "<url>" --length medium
```

## A channel

```powershell
# last 30 uploads, one JSON object per line (fast, no per-video page loads)
yt-dlp --flat-playlist --playlist-end 30 --dump-json "https://www.youtube.com/@<handle>/videos" > channel.jsonl
# full stats for those videos (slower; ~1-2 s per video)
yt-dlp --skip-download --playlist-end 30 --print "%(upload_date)s|%(view_count)s|%(like_count)s|%(comment_count)s|%(duration)s|%(title)s" "https://www.youtube.com/@<handle>/videos" > stats.txt
```

Then compute with **Python via exec** (never estimate numbers yourself): views per day since upload, like/view
ratio, median vs. top videos, best upload weekday, title length and keyword patterns of the top 20%. Present a short
table and 3-5 concrete takeaways.

## Content ideas / scripts

For idea or script requests: analyze 2-3 competitor channels the user names (same steps), find topics that perform
above their channel median, then propose ideas with a title, hook (first 15 s), outline and why it should work.
Mark which numbers are measured and which are your judgment.

## Limits

- Public data only: views/likes/comments/transcripts. Watch time, retention, CTR and revenue need the YouTube
  Analytics API with the user's OAuth login - say so if asked.
- yt-dlp can break when YouTube changes; update with `winget upgrade yt-dlp.yt-dlp`.
- Don't download videos unless the user asks.
