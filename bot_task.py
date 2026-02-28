import os
import json
import discord
import feedparser
import asyncio
from openai import OpenAI
from supabase import create_client

def log(msg):
    print(f">> [LOG] {msg}", flush=True)

async def main():
    try:
        log("프로그램 시작")
        # 1. 키 로드 점검
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            log("❌ 에러: Supabase 키를 깃허브 Secrets에서 찾을 수 없습니다.")
            return
        
        # 2. 클라이언트 초기화
        supabase = create_client(url, key)
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        log("클라이언트 초기화 완료")

        # 3. 뉴스 1개만 테스트 분석
        feed = feedparser.parse("https://news.naver.com/rss/main/101")
        if feed.entries:
            test_entry = feed.entries[0]
            log(f"테스트 기사 발견: {test_entry.title[:15]}")
            
            # OpenAI 분석
            res = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": f"제목: {test_entry.title} 분류(금리,물가,반도체,부동산,유행) JSON"}],
                response_format={ "type": "json_object" }
            )
            ai_data = json.loads(res.choices[0].message.content)
            log(f"AI 분석 성공: {ai_data.get('sector')}")

            # DB 저장 (이게 핵심)
            db_res = supabase.table("news_sentiment").insert({
                "title": test_entry.title,
                "sector": ai_data.get('sector', '기타'),
                "sentiment_score": 0,
                "summary": "테스트",
                "source": test_entry.link
            }).execute()
            log("✅ DB 저장 명령 전송 완료")
        
        # 4. 디스코드 전송 (간소화)
        intents = discord.Intents.default()
        dc = discord.Client(intents=intents)

        @dc.event
        async def on_ready():
            log(f"디스코드 로그인 성공: {dc.user}")
            ch = dc.get_channel(int(os.getenv("TARGET_CHANNEL_ID")))
            if ch:
                await ch.send("🚀 시스템 진단 테스트: DB 저장 및 전송 성공")
            await dc.close()

        log("디스코드 접속 시도...")
        await asyncio.wait_for(dc.start(os.getenv("DISCORD_TOKEN")), timeout=60.0)

    except Exception as e:
        log(f"⚠️ 치명적 에러 발생: {str(e)}")

if __name__ == "__main__":
    asyncio.run(main())
