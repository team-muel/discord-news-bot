import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

# GitHub Secrets 로드
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_KEY)

async def run_news_collection():
    print("🔎 주요 경제지 헤드라인 분석 시작...")
    # 주요 경제지 검색
    search_query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    encoded_query = urllib.parse.quote(search_query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    if not feed or not feed.entries:
        print("⚠️ 기사를 찾지 못했습니다.")
        return

    for entry in feed.entries[:30]:
        prompt = f"제목: {entry.title}\n분류: 금리/물가/반도체/부동산/유행 중 하나(없으면 기타)\n반드시 JSON 형식으로만 응답."
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt + ' 반드시 {"sector": "분류", "sentiment_score": 정수, "summary": "요약"} 형식으로 답해. 소수점 절대 금지.'}],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            sector = ai_res.get('sector', '기타')
            
            if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                # 소수점 에러 원천 차단
                score = int(round(float(ai_res.get('sentiment_score', 0))))
                data = {
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": score,
                    "summary": ai_res.get('summary', ''),
                    "source": entry.link
                }
                supabase.table("news_sentiment").insert(data).execute()
        except Exception as e:
            print(f"❌ 개별 분석 오류 무시: {e}")
            continue

async def main():
    await run_news_collection()
    
    intents = discord.Intents.default()
    discord_client = discord.Client(intents=intents)

    @discord_client.event
    async def on_ready():
        print(f"✅ {discord_client.user} 로그인 성공. 전송 시작...")
        channel = discord_client.get_channel(TARGET_CHANNEL_ID)
        if channel:
            sectors = ["금리", "물가", "반도체", "부동산", "유행"]
            await channel.send("🗞️ **[GitHub 자동 배달] 오늘의 5대 핵심 리포트**")
            for sector in sectors:
                res = supabase.table("news_sentiment").select("*").eq("sector", sector).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    color = 0x2ecc71 if item['sentiment_score'] > 0 else 0xe74c3c if item['sentiment_score'] < 0 else 0x95a5a6
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], color=color, url=item['source'])
                    embed.add_field(name="심리 점수", value=f"{item['sentiment_score']}점")
                    await channel.send(embed=embed)
        print("🏁 전송 완료. 종료합니다.")
        await discord_client.close()

    await discord_client.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
