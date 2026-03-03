import os
import asyncio
import discord
import feedparser
from supabase import create_client

# 설정 정보
CHANNEL_ID = "UC6dN6Rilzh9KmzymxnZGslg"  # 센서스튜디오 채널 ID
RSS_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID = 1478211311480471747 # 유튜브 알림 전용 채널 ID

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

async def check_youtube():
    print(">> [YouTube] 업데이트 확인 시작...")
    # RSS 피드 파싱
    feed = await asyncio.to_thread(feedparser.parse, RSS_URL)
    if not feed.entries: return

    latest_video = feed.entries[0]
    v_id = latest_video.yt_videoid
    v_url = latest_video.link
    v_title = latest_video.title

    # DB 조회 (이미 보낸 영상인지 확인)
    res = supabase.table("youtube_log").select("video_id").eq("channel_id", CHANNEL_ID).execute()
    
    # 중복이 아닐 경우에만 발송
    if not res.data or res.data[0]['video_id'] != v_id:
        intents = discord.Intents.default()
        client = discord.Client(intents=intents)

        @client.event
        async def on_ready():
            ch = client.get_channel(TARGET_CHANNEL_ID)
            if ch:
                await ch.send(f"📢 **센서스튜디오 신규 영상 업로드!**\n**제목:** {v_title}\n{v_url}")
                print(f">> [YouTube] 알림 발송 완료: {v_title}")
            
            # DB 기록 업데이트
            if not res.data:
                supabase.table("youtube_log").insert({"channel_id": CHANNEL_ID, "video_id": v_id}).execute()
            else:
                supabase.table("youtube_log").update({"video_id": v_id}).eq("channel_id", CHANNEL_ID).execute()
            await client.close()

        await client.start(DISCORD_TOKEN)
    else:
        print(f">> [YouTube] 중복 영상 패스: {v_title}")

if __name__ == "__main__":
    asyncio.run(check_youtube())
