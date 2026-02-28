import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
import time
from openai import OpenAI
from supabase import create_client

def log(msg):
    print(f">> [LOG] {msg}", flush=True)

# 1. 초기 설정
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

async def main():
    # --- [1단계: 구글 뉴스 수집 및 AI 섹터 분류] ---
    log("1단계 시작: 뉴스 수집 및 AI 분석")
    query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    save_count = 0

    # 분석 대상 기사를 10개로 한정하여 집중 분석
    for entry in feed.entries[:10]:
        log(f"🔎 분석 시도: {entry.title[:20]}...")
        
        # 네트워크 에러 대비 최대 3번 재시도 로직
        for retry in range(3):
            try:
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": f"제목: {entry.title}\n5대 섹터(금리, 물가, 반도체, 부동산, 유행) 중 하나로 분류하고 JSON으로 출력해."}],
                    response_format={ "type": "json_object" },
                    timeout=20 # 응답 지연 방지
                )
                ai_res = json.loads(response.choices[0].message.content)
                sector = ai_res.get('sector')

                # AI가 5개 섹터 중 하나로 판단했을 때만 DB 저장
                if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                    supabase.table("news_sentiment").insert({
                        "title": entry.title,
                        "sector": sector,
                        "sentiment_score": int(round(float(ai_res.get('sentiment_score', 0)))),
                        "summary": ai_res.get('summary', ''),
                        "source": entry.link
                    }).execute()
                    save_count += 1
                    log(f"   ✅ DB 저장 성공: [{sector}]")
                break # 성공 시 재시도 루프 탈출
            except Exception as e:
                log(f"   ⚠️ 재시도 중 ({retry+1}/3): {e}")
                time.sleep(2) # 잠시 대기 후 재시도

    log(f"1단계 완료: 총 {save_count}건의 섹터 데이터가 DB에 쌓였습니다.")

    # --- [2단계: 저장된 데이터를 Supabase에서 불러와 디스코드 전송] ---
    if save_count == 0:
        log("❌ DB에 저장된 새로운 데이터가 없어 전송을 중단합니다.")
        return

    log("2단계 시작: 디스코드 접속 및 최신 데이터 송신")
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        log(f"디스코드 로그인 성공: {dc.user}")
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        if ch:
            await ch.send("🗞️ **[시스템] AI가 분석한 최신 경제 섹터 리포트**")
            for s in ["금리", "물가", "반도체", "부동산", "유행"]:
                # Supabase에서 방금 넣은 각 섹터별 가장 최신 기사 1개씩 호출
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    color = 0x2ecc71 if item['sentiment_score'] > 0 else 0xe74c3c
                    embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)
                    embed.add_field(name="심리 점수", value=f"{item['sentiment_score']}점")
                    await ch.send(embed=embed)
                    log(f"   📤 {s} 섹터 리포트 발송")
        
        log("🏁 모든 프로세스 완료. 종료합니다.")
        await dc.close()

    await dc.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
