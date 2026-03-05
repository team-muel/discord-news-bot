import os
import asyncio
import discord
import feedparser
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# 설정
CHANNEL_ID = "UC6dN6Rilzh9KmzymxnZGslg"
RSS_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
# 여기는 환경변수로 덮어쓸 수 있도록 지원
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID") or "1478211311480471747")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_KEY must be set in environment")
if not DISCORD_TOKEN:
    raise SystemExit("DISCORD_TOKEN must be set in environment")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

async def check_youtube():
    print(">> 업데이트 확인 시작...")
    feed = await asyncio.to_thread(feedparser.parse, RSS_URL)
    if not feed.entries:
        return

    latest_video = feed.entries[0]
    v_id = latest_video.yt_videoid
    v_url = latest_video.link
    v_title = latest_video.title

    # DB 조회
    try:
        res = supabase.table("youtube_log").select("video_id").eq("channel_id", CHANNEL_ID).execute()
    except Exception as e:
        print(f">> DB 조회 오류: {e}")
        res = None

    if not res or not getattr(res, 'data', None) or res.data == [] or res.data[0].get('video_id') != v_id:
        intents = discord.Intents.default()
        client = discord.Client(intents=intents)

        @client.event
        async def on_ready():
                try:
                    # get_channel 대신 fetch_channel을 사용하여 확실하게 채널을 가져옵니다.
                    ch = await client.fetch_channel(TARGET_CHANNEL_ID)
                    if ch:
                        await ch.send(f"📢 **센서스튜디오 신규 영상 업로드!**\n**제목:** {v_title}\n{v_url}")
                        print(f">> 알림 발송 성공: {v_title}")

                    # DB 업데이트
                    try:
                        if not res or not getattr(res, 'data', None) or res.data == []:
                            supabase.table("youtube_log").insert({"channel_id": CHANNEL_ID, "video_id": v_id}).execute()
                        else:
                            supabase.table("youtube_log").update({"video_id": v_id}).eq("channel_id", CHANNEL_ID).execute()
                    except Exception as e:
                        print(f">> DB 저장 오류: {e}")
                except Exception as e:
                    print(f">> 오류 발생: {e}")
                finally:
                    await client.close()

        await client.start(DISCORD_TOKEN)
    else:
        print(f">> 중복 영상 패스: {v_title}")

if __name__ == "__main__":
    asyncio.run(check_youtube())
