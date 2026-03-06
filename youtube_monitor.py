import os
import asyncio
import discord
import feedparser
import sys
from supabase import create_client
from dotenv import load_dotenv
from discord.ext import tasks
from automation_common import is_missing_table_error, parse_int_env, pick_env

load_dotenv()

# 설정
CHANNEL_ID = "UC6dN6Rilzh9KmzymxnZGslg"
RSS_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = pick_env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
YOUTUBE_DISCORD_TOKEN = pick_env("SECONDARY_DISCORD_TOKEN", "AUTOMATION_DISCORD_TOKEN")
# 여기는 환경변수로 덮어쓸 수 있도록 지원
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID") or "1478211311480471747")
AUTOMATION_INTERVAL_MIN = parse_int_env("AUTOMATION_JOB_INTERVAL_MIN", "AUTOMATION_YOUTUBE_INTERVAL_MIN", default=10, min_value=1)
DAEMON_MODE = "--daemon" in sys.argv
SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)
LAST_VIDEO_ID = None

if not YOUTUBE_DISCORD_TOKEN:
    raise SystemExit("SECONDARY_DISCORD_TOKEN (or AUTOMATION_DISCORD_TOKEN) must be set in environment")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_ENABLED else None
YOUTUBE_TABLE_AVAILABLE = SUPABASE_ENABLED
YOUTUBE_TABLE_ERROR_LOGGED = False

def disable_youtube_table_if_missing(err):
    global YOUTUBE_TABLE_AVAILABLE, YOUTUBE_TABLE_ERROR_LOGGED
    if YOUTUBE_TABLE_AVAILABLE and is_missing_table_error(err, "youtube_log"):
        YOUTUBE_TABLE_AVAILABLE = False
        if not YOUTUBE_TABLE_ERROR_LOGGED:
            YOUTUBE_TABLE_ERROR_LOGGED = True
            print(">> ⚠️ youtube_log 테이블을 찾지 못해 no-db 모드로 전환합니다.")

async def check_youtube(client: discord.Client):
    global LAST_VIDEO_ID
    print(">> 업데이트 확인 시작...")
    feed = await asyncio.to_thread(feedparser.parse, RSS_URL)
    if not feed.entries:
        print(">> [DAEMON] tick complete: no entries")
        return

    latest_video = feed.entries[0]
    v_id = latest_video.yt_videoid
    v_url = latest_video.link
    v_title = latest_video.title

    # DB 조회 (or in-memory fallback)
    res = None
    if SUPABASE_ENABLED and YOUTUBE_TABLE_AVAILABLE and supabase is not None:
        try:
            res = supabase.table("youtube_log").select("video_id").eq("channel_id", CHANNEL_ID).execute()
        except Exception as e:
            disable_youtube_table_if_missing(e)
            print(f">> DB 조회 오류(폴백): {e}")
            res = None
    else:
        if LAST_VIDEO_ID == v_id:
            print(f">> 중복 영상 패스(in-memory): {v_title}")
            print(">> [DAEMON] tick complete")
            return

    if not res or not getattr(res, 'data', None) or res.data == [] or res.data[0].get('video_id') != v_id:
        try:
            ch = await client.fetch_channel(TARGET_CHANNEL_ID)
            if ch:
                await ch.send(f"📢 **센서스튜디오 신규 영상 업로드!**\n**제목:** {v_title}\n{v_url}")
                print(f">> [DAEMON] alert sent: {v_title}")

            try:
                if SUPABASE_ENABLED and YOUTUBE_TABLE_AVAILABLE and supabase is not None:
                    try:
                        if not res or not getattr(res, 'data', None) or res.data == []:
                            supabase.table("youtube_log").insert({"channel_id": CHANNEL_ID, "video_id": v_id}).execute()
                        else:
                            supabase.table("youtube_log").update({"video_id": v_id}).eq("channel_id", CHANNEL_ID).execute()
                    except Exception as e:
                        disable_youtube_table_if_missing(e)
                        LAST_VIDEO_ID = v_id
                        print(f">> DB 저장 오류(폴백): {e}")
                else:
                    LAST_VIDEO_ID = v_id
            except Exception as e:
                print(f">> DB 저장 오류: {e}")
        except Exception as e:
            print(f">> 오류 발생: {e}")
    else:
        print(f">> 중복 영상 패스: {v_title}")

    print(">> [DAEMON] tick complete")


async def run_once_mode():
    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        try:
            await check_youtube(client)
        finally:
            await client.close()

    await client.start(YOUTUBE_DISCORD_TOKEN)


async def run_daemon_mode():
    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    @tasks.loop(minutes=AUTOMATION_INTERVAL_MIN)
    async def periodic_check():
        await check_youtube(client)

    @client.event
    async def on_ready():
        print(f">> [DAEMON] youtube-monitor connected, interval={AUTOMATION_INTERVAL_MIN}m")
        if not periodic_check.is_running():
            periodic_check.start()
        await check_youtube(client)

    await client.start(YOUTUBE_DISCORD_TOKEN)

if __name__ == "__main__":
    if not SUPABASE_ENABLED:
        print(">> SUPABASE missing: running in no-db mode")
    if DAEMON_MODE:
        asyncio.run(run_daemon_mode())
    else:
        asyncio.run(run_once_mode())
