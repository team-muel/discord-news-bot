import os
import sys
import subprocess

# =================================================================
# [협업 참고: 자동 의존성 설치 로직]
# Render.com의 Node.js 환경에서 Python 패키지(dotenv 등)가 설치되지 않아 
# 발생하는 'ModuleNotFoundError'를 방지하기 위해 추가된 로직
# 스크립트 실행 시 필요한 라이브러리가 없으면 pip를 통해 자동으로 설치함.
# =================================================================
def install_dependencies():
    # 설치가 필요한 패키지 목록 (패키지명: import시 이름)
    required_packages = {
        "python-dotenv": "dotenv",
        "discord.py": "discord",
        "feedparser": "feedparser",
        "supabase": "supabase"
    }
    
    for package, import_name in required_packages.items():
        try:
            # 이미 설치되어 있는지 확인
            __import__(import_name)
        except ImportError:
            # 설치되어 있지 않다면 현재 파이썬 인터프리터를 사용하여 pip 설치 실행
            print(f">> [System] 필수 모듈 '{package}'이(가) 없습니다. 자동 설치를 시작합니다...")
            try:
                # sys.executable을 사용하여 현재 실행 중인 파이썬 환경에 설치
                subprocess.check_call([sys.executable, "-m", "pip", "install", package])
                print(f">> [System] '{package}' 설치 완료.")
            except Exception as e:
                print(f">> [Error] '{package}' 설치 중 오류 발생: {e}")

# 라이브러리를 import하기 전에 먼저 실행하여 환경을 조성합니다.
install_dependencies()
# =================================================================

import asyncio
import discord
import feedparser
from supabase import create_client
from dotenv import load_dotenv
from discord.ext import tasks

# .env 파일 로드 (환경변수 관리)
load_dotenv()

# --- 유튜브 및 서비스 설정 ---
CHANNEL_ID = "UC6dN6Rilzh9KmzymxnZGslg"
RSS_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("SUPABASE_KEY")
)
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
# 세컨드 봇이나 자동화 전용 토큰 확인
YOUTUBE_DISCORD_TOKEN = os.getenv("SECONDARY_DISCORD_TOKEN") or os.getenv("AUTOMATION_DISCORD_TOKEN")

# 대상 디스코드 채널 ID 및 실행 간격 설정
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID") or "1478211311480471747")
AUTOMATION_INTERVAL_MIN = max(1, int(os.getenv("AUTOMATION_JOB_INTERVAL_MIN") or os.getenv("AUTOMATION_YOUTUBE_INTERVAL_MIN") or "10"))

# 실행 인자에 --daemon이 포함되어 있는지 확인
DAEMON_MODE = "--daemon" in sys.argv
SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)
LAST_VIDEO_ID = None

# 토큰 미설정 시 실행 중단
if not YOUTUBE_DISCORD_TOKEN:
    raise SystemExit("SECONDARY_DISCORD_TOKEN (or AUTOMATION_DISCORD_TOKEN) must be set in environment")

# Supabase 클라이언트 초기화
supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_ENABLED else None
YOUTUBE_TABLE_AVAILABLE = SUPABASE_ENABLED
YOUTUBE_TABLE_ERROR_LOGGED = False

# DB 테이블 존재 여부 확인용 헬퍼 함수
def is_missing_table_error(err, table_name: str) -> bool:
    text = str(err).lower()
    return (
        "pgrst205" in text  # PostgREST 테이블 없음 오류 코드
        or f"'{table_name}'" in text
        or f'"{table_name}"' in text
        or (table_name.lower() in text and "schema cache" in text)
    )

# 테이블이 없을 경우 DB 기능을 끄고 메모리 기반(no-db) 모드로 전환
def disable_youtube_table_if_missing(err):
    global YOUTUBE_TABLE_AVAILABLE, YOUTUBE_TABLE_ERROR_LOGGED
    if YOUTUBE_TABLE_AVAILABLE and is_missing_table_error(err, "youtube_log"):
        YOUTUBE_TABLE_AVAILABLE = False
        if not YOUTUBE_TABLE_ERROR_LOGGED:
            YOUTUBE_TABLE_ERROR_LOGGED = True
            print(">> ⚠️ youtube_log 테이블을 찾지 못해 no-db 모드로 전환합니다.")

# 유튜브 신규 영상 체크 메인 로직
async def check_youtube(client: discord.Client):
    global LAST_VIDEO_ID
    print(">> 업데이트 확인 시작...")
    
    # RSS 피드 파싱 (Blocking 함수이므로 thread에서 실행)
    feed = await asyncio.to_thread(feedparser.parse, RSS_URL)
    if not feed.entries:
        print(">> [DAEMON] tick complete: no entries")
        return

    latest_video = feed.entries[0]
    v_id = latest_video.yt_videoid
    v_url = latest_video.link
    v_title = latest_video.title

    # 중복 알림 방지 로직 (DB 또는 메모리 비교)
    res = None
    if SUPABASE_ENABLED and YOUTUBE_TABLE_AVAILABLE and supabase is not None:
        try:
            res = supabase.table("youtube_log").select("video_id").eq("channel_id", CHANNEL_ID).execute()
        except Exception as e:
            disable_youtube_table_if_missing(e)
            print(f">> DB 조회 오류(폴백): {e}")
            res = None
    else:
        # DB를 사용할 수 없는 경우 메모리 변수(LAST_VIDEO_ID)와 비교
        if LAST_VIDEO_ID == v_id:
            print(f">> 중복 영상 패스(in-memory): {v_title}")
            print(">> [DAEMON] tick complete")
            return

    # 신규 영상 발견 시 (DB 데이터가 없거나, 저장된 ID와 현재 ID가 다른 경우)
    if not res or not getattr(res, 'data', None) or res.data == [] or res.data[0].get('video_id') != v_id:
        try:
            ch = await client.fetch_channel(TARGET_CHANNEL_ID)
            if ch:
                await ch.send(f"📢 **센서스튜디오 신규 영상 업로드!**\n**제목:** {v_title}\n{v_url}")
                print(f">> [DAEMON] alert sent: {v_title}")

            # DB에 최신 영상 ID 업데이트
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

# 1회성 실행 모드 (CI/CD용)
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

# 백그라운드 상시 실행 모드 (Render Worker용)
async def run_daemon_mode():
    intents = discord.Intents.default()
    client = discord.Client(intents=intents)

    # 설정된 시간 간격마다 자동 반복
    @tasks.loop(minutes=AUTOMATION_INTERVAL_MIN)
    async def periodic_check():
        await check_youtube(client)

    @client.event
    async def on_ready():
        print(f">> [DAEMON] youtube-monitor connected, interval={AUTOMATION_INTERVAL_MIN}m")
        if not periodic_check.is_running():
            periodic_check.start()
        # 시작하자마자 첫 체크 수행
        await check_youtube(client)

    await client.start(YOUTUBE_DISCORD_TOKEN)

if __name__ == "__main__":
    if not SUPABASE_ENABLED:
        print(">> SUPABASE missing: running in no-db mode")
        
    if DAEMON_MODE:
        async def main():
            await run_daemon_mode()
        asyncio.run(main())
    else:
        async def main():
            await run_once_mode()
        asyncio.run(main())
