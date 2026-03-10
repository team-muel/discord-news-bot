import os
import json
import discord
import feedparser
import asyncio
import urllib.parse
import sys
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv
from discord.ext import tasks
import requests
from io import BytesIO
from discord import app_commands
from discord.ext import commands
from automation_common import is_missing_table_error, log, parse_int_env, pick_env

_PDF_READER = None
_PANDAS = None
_PYPLOT = None


def get_pdf_reader():
    global _PDF_READER
    if _PDF_READER is not None:
        return _PDF_READER

    try:
        from PyPDF2 import PdfReader as _Reader
        _PDF_READER = _Reader
        return _PDF_READER
    except Exception:
        return None


def get_chart_libs():
    global _PANDAS, _PYPLOT
    if _PANDAS is not None and _PYPLOT is not None:
        return _PANDAS, _PYPLOT

    try:
        import pandas as _pd
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as _plt

        _PANDAS = _pd
        _PYPLOT = _plt
        return _PANDAS, _PYPLOT
    except Exception:
        return None, None

load_dotenv()

# 1. 초기 설정 및 클라이언트 준비
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = pick_env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
NEWS_DISCORD_TOKEN = pick_env("DISCORD_TOKEN", "DISCORD_BOT_TOKEN", "AUTOMATION_DISCORD_TOKEN")
TARGET_CHANNEL_ID_RAW = os.getenv("TARGET_CHANNEL_ID")
AUTOMATION_INTERVAL_MIN = parse_int_env("AUTOMATION_JOB_INTERVAL_MIN", "AUTOMATION_NEWS_INTERVAL_MIN", default=30, min_value=1)
DAEMON_MODE = "--daemon" in sys.argv
SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)

if not NEWS_DISCORD_TOKEN:
    raise SystemExit("DISCORD_TOKEN (or DISCORD_BOT_TOKEN) must be set in environment")
if not TARGET_CHANNEL_ID_RAW:
    raise SystemExit("TARGET_CHANNEL_ID must be set in environment")

try:
    TARGET_CHANNEL_ID = int(TARGET_CHANNEL_ID_RAW)
except ValueError:
    raise SystemExit("TARGET_CHANNEL_ID must be an integer")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_ENABLED else None
ai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
latest_results = {}
NEWS_TABLE_AVAILABLE = SUPABASE_ENABLED
NEWS_TABLE_ERROR_LOGGED = False

def disable_news_table_if_missing(err):
    global NEWS_TABLE_AVAILABLE, NEWS_TABLE_ERROR_LOGGED
    if NEWS_TABLE_AVAILABLE and is_missing_table_error(err, "news_sentiment"):
        NEWS_TABLE_AVAILABLE = False
        if not NEWS_TABLE_ERROR_LOGGED:
            NEWS_TABLE_ERROR_LOGGED = True
            log("⚠️ news_sentiment 테이블을 찾지 못해 no-db 모드로 전환합니다.")


def fallback_analysis(title: str):
    lowered = title.lower()

    sector_rules = [
        ("세계전쟁상황", ["전쟁", "교전", "미사일", "중동", "우크라", "러시아", "이스라엘", "이란", "군사", "휴전"]),
        ("금리", ["금리", "fomc", "fed", "연준", "기준금리", "국채", "채권"]),
        ("물가", ["물가", "cpi", "ppi", "인플레", "인플레이션", "소비자물가"]),
        ("반도체", ["반도체", "메모리", "hbm", "파운드리", "엔비디아", "삼성전자", "sk하이닉스"]),
        ("부동산", ["부동산", "아파트", "주택", "분양", "전세", "재건축", "재개발"]),
    ]

    sector = "세계전쟁상황"
    for candidate, keywords in sector_rules:
        if any(keyword in lowered for keyword in keywords):
            sector = candidate
            break

    positive_words = ["상승", "회복", "개선", "호재", "완화", "증가", "안정", "돌파"]
    negative_words = ["하락", "급락", "악화", "위기", "불안", "긴장", "충돌", "침체", "경고"]

    score = 0
    for word in positive_words:
        if word in lowered:
            score += 1
    for word in negative_words:
        if word in lowered:
            score -= 1

    if score == 0:
        score = -1 if sector == "세계전쟁상황" else 1

    score = max(-5, min(5, score))
    summary = f"{sector} 관련 핵심 이슈: {title}"
    return {"sector": sector, "sentiment_score": score, "summary": summary}

async def main():
    global NEWS_TABLE_AVAILABLE
    log("1단계: 강화된 AI 심리 분석 시작 (섹터: 세계전쟁상황 업데이트)")
    
    # [수정] 검색 키워드에 '전쟁', '교전', '이란', '중동' 등을 추가하여 관련 뉴스를 유도합니다.
    query = '("매일경제" OR "한국경제") (금리 OR 물가 OR 반도체 OR 부동산 OR "세계전쟁" OR "전쟁" OR "교전" OR "이란")'
    rss_url = f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=ko&gl=KR&ceid=KR:ko"
    
    feed = await asyncio.to_thread(feedparser.parse, rss_url)
    save_count = 0

    # 유효 섹터 정의
    valid_sectors = ["금리", "물가", "반도체", "부동산", "세계전쟁상황"]

    for entry in feed.entries[:15]:
        try:
            if ai_client:
                response = ai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{
                        "role": "user", 
                        "content": f"""
                        다음 뉴스 제목을 분석해서 경제/국제 섹터를 분류하고 '시장 심리 점수'를 매겨줘.
                        제목: {entry.title}
                        
                        [채점 규칙]
                        1. 섹터: 금리, 물가, 반도체, 부동산, 세계전쟁상황 중 하나.
                        * 전쟁, 군사 충돌, 중동 정세 등은 반드시 '세계전쟁상황'으로 분류해.
                        2. sentiment_score: -5(매우 심각한 악재/불안)에서 5(엄청난 호재/안정) 사이의 정수. 
                        * 아주 사소한 영향이라도 있다면 0점 대신 1이나 -1을 줘. 중립(0)은 가급적 피할 것.
                        3. summary: 기사 내용을 한 문장으로 요약.
                        
                        반드시 아래 JSON 형식으로만 답해:
                        {{"sector": "분류", "sentiment_score": 숫자, "summary": "요약"}}
                        """
                    }],
                    response_format={ "type": "json_object" }
                )
                # 안전한 JSON 파싱 및 값 검증
                try:
                    ai_content = response.choices[0].message.content
                    ai_res = json.loads(ai_content)
                except Exception as e:
                    log(f"   ⚠️ AI 응답 파싱 실패, 폴백 사용: {e}")
                    ai_res = fallback_analysis(entry.title)
            else:
                ai_res = fallback_analysis(entry.title)

            sector = ai_res.get('sector')
            if sector in valid_sectors:
                raw_score = ai_res.get('sentiment_score', 0)
                try:
                    score = int(float(raw_score))
                except Exception:
                    score = 0
                # 점수 범위 제한
                score = max(-5, min(5, score))

                summary = ai_res.get('summary', '분석 완료')
                latest_results[sector] = {
                    "sector": sector,
                    "title": entry.title,
                    "sentiment_score": score,
                    "summary": summary,
                    "source": entry.link,
                }

                if SUPABASE_ENABLED and NEWS_TABLE_AVAILABLE and supabase is not None:
                    try:
                        res = supabase.table("news_sentiment").insert({
                            "title": entry.title,
                            "sector": sector,
                            "sentiment_score": score,
                            "summary": summary,
                            "source": entry.link
                        }).execute()
                        # 간단한 결과 체크
                        if hasattr(res, 'status_code') and res.status_code >= 400:
                            log(f"   ⚠️ DB 저장 실패 status={getattr(res, 'status_code', 'unknown')}")
                            save_count += 1
                            log(f"   ✅ no-db 분석(저장 실패 폴백): [{sector}] 심리점수: {score}점")
                        else:
                            save_count += 1
                            log(f"   ✅ DB 저장: [{sector}] 심리점수: {score}점")
                    except Exception as db_err:
                        disable_news_table_if_missing(db_err)
                        save_count += 1
                        log(f"   ✅ no-db 분석(DB 예외 폴백): [{sector}] 심리점수: {score}점")
                else:
                    save_count += 1
                    log(f"   ✅ no-db 분석: [{sector}] 심리점수: {score}점")
        except Exception as e:
            log(f"   ⚠️ 오류: {e}")
            continue

    if save_count == 0:
        log("❌ 신규 데이터 없음")
        return

    if SUPABASE_ENABLED:
        return valid_sectors

    return list(latest_results.keys())


async def send_report(dc: discord.Client, sectors):
    log("2단계: 디스코드 리포트 카드 발송")
    ch = dc.get_channel(TARGET_CHANNEL_ID)
    if not ch:
        ch = await dc.fetch_channel(TARGET_CHANNEL_ID)

    if not ch:
        log("❌ 채널 접근 실패")
        return

    await ch.send("📊 **AI 경제/국제 정세 분석 리포트**")
    for s in sectors:
        if SUPABASE_ENABLED and NEWS_TABLE_AVAILABLE and supabase is not None:
            try:
                res = supabase.table("news_sentiment").select("*").eq("sector", s).order("created_at", desc=True).limit(1).execute()
                if not res.data:
                    item = latest_results.get(s)
                    if not item:
                        continue
                else:
                    item = res.data[0]
            except Exception as db_err:
                disable_news_table_if_missing(db_err)
                item = latest_results.get(s)
                if not item:
                    continue
        else:
            item = latest_results.get(s)
            if not item:
                continue

        score = int(item['sentiment_score'])

        if score > 0:
            color = 0x2ecc71
        elif score < 0:
            color = 0xe74c3c
        else:
            color = 0x95a5a6

        embed = discord.Embed(title=f"[{item['sector']}] {item['title']}", description=item['summary'], url=item['source'], color=color)

        gauge = "🟦" * (score + 5) if score >= 0 else "🟥" * (score + 5)
        embed.add_field(name="AI 심리 지수", value=f"**{score}점**\n{gauge}")

        await ch.send(embed=embed)

    log("[DAEMON] report sent")


async def run_cycle(dc: discord.Client):
    sectors = await main()
    if sectors:
        await send_report(dc, sectors)
    log("[DAEMON] tick complete")


async def run_once_mode():
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @dc.event
    async def on_ready():
        try:
            await run_cycle(dc)
        finally:
            await dc.close()

    await dc.start(NEWS_DISCORD_TOKEN)


async def run_daemon_mode():
    intents = discord.Intents.default()
    dc = discord.Client(intents=intents)

    @tasks.loop(minutes=AUTOMATION_INTERVAL_MIN)
    async def periodic_job():
        await run_cycle(dc)

    @dc.event
    async def on_ready():
        log(f"[DAEMON] news-analysis connected, interval={AUTOMATION_INTERVAL_MIN}m")
        if not periodic_job.is_running():
            periodic_job.start()
        await run_cycle(dc)

    await dc.start(NEWS_DISCORD_TOKEN)


async def get_history(user_id):
    if not supabase:
        return []
    def _get():
        res = supabase.table("chat_history") \
            .select("role,content") \
            .eq("user_id", str(user_id)) \
            .order("created_at") \
            .limit(10) \
            .execute()
        return getattr(res, 'data', [])
    return await asyncio.to_thread(_get)


async def save_history(user_id, role, content):
    if not supabase:
        return
    def _save():
        supabase.table("chat_history").insert({
            "user_id": str(user_id),
            "role": role,
            "content": content
        }).execute()
    await asyncio.to_thread(_save)


async def clear_history(user_id):
    if not supabase:
        return
    def _clear():
        supabase.table("chat_history").delete().eq("user_id", str(user_id)).execute()
    await asyncio.to_thread(_clear)


async def get_pdf_text(attachment):
    try:
        reader_cls = get_pdf_reader()
        if reader_cls is None:
            return ""

        res = await asyncio.to_thread(requests.get, attachment.url)
        reader = reader_cls(BytesIO(res.content))
        return "".join([p.extract_text() or "" for p in reader.pages[:5]])[:3000]
    except Exception:
        return ""


async def get_naver_news(query):
    try:
        encoded = urllib.parse.quote(f"{query} 실적 매출")
        feed = await asyncio.to_thread(
            feedparser.parse,
            f"https://newssearch.naver.com/search.naver?where=rss&query={encoded}"
        )

        if feed.entries:
            return {
                "title": feed.entries[0].title,
                "link": feed.entries[0].link
            }

    except Exception:
        return None


ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_KEY")


def get_stock_price(symbol):
    if not ALPHA_VANTAGE_KEY:
        return None
    url = f"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={symbol}&apikey={ALPHA_VANTAGE_KEY}"
    r = requests.get(url).json()
    data = r.get("Global Quote", {})
    if not data:
        return None
    return {
        "price": data.get("05. price"),
        "high": data.get("03. high"),
        "low": data.get("04. low"),
        "open": data.get("02. open"),
        "prev": data.get("08. previous close")
    }


def get_stock_chart(symbol):
    if not ALPHA_VANTAGE_KEY:
        return None

    pd, plt = get_chart_libs()
    if pd is None or plt is None:
        return None

    url = f"https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={ALPHA_VANTAGE_KEY}"
    r = requests.get(url).json()
    ts = r.get("Time Series (Daily)")
    if not ts:
        return None
    df = pd.DataFrame(ts).T
    df = df.astype(float)
    df = df.sort_index()
    close = df["4. close"].tail(30)
    plt.figure()
    close.plot()
    plt.title(f"{symbol} Price")
    plt.xlabel("Date")
    plt.ylabel("Price")
    buf = BytesIO()
    plt.savefig(buf)
    plt.close()
    buf.seek(0)
    return buf


async def start_command_bot():
    if not DISCORD_TOKEN:
        log("DISCORD_TOKEN missing: command bot disabled")
        return

    intents = discord.Intents.default()
    intents.message_content = True
    bot = commands.Bot(command_prefix="!", intents=intents)

    @bot.event
    async def on_ready():
        try:
            await bot.tree.sync()
        except Exception:
            pass
        log("✅ 명령봇 가동 (슬래시 명령)")

    @bot.tree.command(name="주가", description="주식 현재 가격 조회")
    async def stock_price(interaction: discord.Interaction, symbol: str):
        await interaction.response.defer()
        data = await asyncio.to_thread(get_stock_price, symbol)
        if not data:
            return await interaction.followup.send("❌ 주가 조회 실패")
        msg = f"""
📈 **{symbol} 주가**

현재 가격: {data['price']}
오늘 최고: {data['high']}
오늘 최저: {data['low']}
오늘 시가: {data['open']}
전일 종가: {data['prev']}
"""
        await interaction.followup.send(msg)

    @bot.tree.command(name="차트", description="주식 차트")
    async def stock_chart(interaction: discord.Interaction, symbol: str):
        await interaction.response.defer()
        chart = await asyncio.to_thread(get_stock_chart, symbol)
        if not chart:
            return await interaction.followup.send("❌ 차트 생성 실패")
        file = discord.File(chart, filename="chart.png")
        embed = discord.Embed(title=f"{symbol} 주가 차트", color=0x2ecc71)
        embed.set_image(url="attachment://chart.png")
        await interaction.followup.send(embed=embed, file=file)

    @bot.tree.command(name="분석", description="기업 분석")
    async def analyze(interaction: discord.Interaction, query: str):
        await interaction.response.defer()
        news = await get_naver_news(query)
        context = ""
        link = ""
        if news:
            context = news["title"]
            link = news["link"]
        prompt = f"""
기업 분석 질문: {query}

뉴스:
{context}

투자 관점에서 분석해줘
"""
        try:
            if ai_client:
                res = ai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": prompt}]
                )
                answer = res.choices[0].message.content
            else:
                answer = "(AI 키 없음) 제공된 뉴스 제목을 기반으로 간단 분석을 수행할 수 없습니다."
        except Exception as e:
            answer = f"AI 응답 실패: {e}"

        embed = discord.Embed(title="📊 AI 투자 분석", description=answer, color=0x3498db)
        if link:
            embed.add_field(name="관련 뉴스", value=f"[기사 보기]({link})")
        await interaction.followup.send(embed=embed)

    await bot.start(DISCORD_TOKEN)


async def async_main():
    # Start both the automation client (NEWS_DISCORD_TOKEN) and the command bot (DISCORD_TOKEN) concurrently
    tasks_list = []
    tasks_list.append(asyncio.create_task(run_daemon_mode()))
    tasks_list.append(asyncio.create_task(start_command_bot()))
    await asyncio.gather(*tasks_list)

if __name__ == "__main__":
    if not SUPABASE_ENABLED:
        log("SUPABASE missing: running in no-db mode")
    if not OPENAI_API_KEY:
        log("OPENAI_API_KEY missing: using fallback analysis mode")
    # Start both the automation daemon and the command bot together.
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        log("shutdown requested")
