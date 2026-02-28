import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
from openai import OpenAI
from supabase import create_client

def log(msg):
    print(f">> [LOG] {msg}", flush=True)

# 초기 설정
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
TARGET_CHANNEL_ID = int(os.getenv("TARGET_CHANNEL_ID"))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
client = OpenAI(api_key=OPENAI_API_KEY)

async def main():
    # --- [1단계: 뉴스 수집 및 AI 심리 분석] ---
    log("1단계: 뉴스 수집 및 AI 심리 점수 분석 시작")
    query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR 유행)'
    rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    save_count = 0

    for entry in feed.entries[:15]:
        try:
            # AI에게 섹터 분류 및 심리 점수(-5 ~ 5) 요청
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "user", 
                    "content": f"제목: {entry.title}\n관련 섹터(금리, 물가, 반도체, 부동산, 유행) 분류하고, 시장 분위기를 -5(악재)에서 5(호재) 사이 정수로 점수 매겨서 JSON으로 답해. 요약도 한 문장 포함해."
                }],
                response_format={ "type": "json_object" }
            )
            ai_res = json.loads(response.choices[0].message.content)
            sector = ai_res.get('sector')
            
            if sector in ["금리", "물가", "반도체", "부동산", "유행"]:
                # 소수점 방지를 위해 정수형 변환
                score = int(ai_res.get('sentiment_score', 0))
                
                supabase.table("news_sentiment").insert({
                    "title": entry.title,
                    "sector": sector,
                    "sentiment_score": score,
                    "summary": ai_res.get('summary', '분석 완료'),
                    "source": entry.link
                }).execute()
                save_count += 1
                log(f"   ✅ DB 저장: [{sector}] 점수: {score}")
        except Exception as e:
            log(f"   ⚠️ 분석 오류: {e}")
            continue

    # --- [2단계: 디스코드 리포트 발송] ---
    if save_count == 0:
        log("❌ 신규 데이터가 없어 전송을 중단합니다.")
        return

    log("2단계: 디스코드 리포트 카드 발송")
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        ch = dc.get_channel(TARGET_CHANNEL_ID)
        if ch:
            await ch.send("📊 **AI 경제 섹터 심리 분석 리포트**")
            for s in ["금리", "물가", "반도체", "부동산", "유행"]:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if res.data:
                    item = res.data[0]
                    score = item['sentiment_score']
                    
                    # 점수에 따른 카드 색상 변경 (양수: 초록, 음수: 빨강, 0: 회색)
                    color = 0x2ecc71 if score > 0 else 0xe74c3c if score < 0 else 0x95a5a6
                    
                    embed = discord.Embed(
                        title=f"[{item['sector']}] {item['title']}", 
                        description=item['summary'], 
                        url=item['source'], 
                        color=color
                    )
                    # 심리 점수를 시각적으로 표시
                    score_text = "📈 호재" if score > 0 else "📉 악재" if score < 0 else "Neutral"
                    embed.add_field(name="AI 심리 지수", value=f"**{score}점** ({score_text})")
                    
                    await ch.send(embed=embed)
                    log(f"   📤 {s} 전송 완료")
        
        await dc.close()

    await dc.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
