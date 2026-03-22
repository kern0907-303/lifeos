// netlify/functions/ai_reading.js
// 修正版：本地運算 + 回傳 lunar_parsed + 嚴禁 Markdown 符號

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resp(200, { ok: true });
  if (event.httpMethod !== "POST") return resp(405, { error: "Method Not Allowed" });

  try {
    const body = safeJsonParse(event.body);
    const mode = String(body.mode || "reading").trim();
    const birthdate = String(body.birthdate || "").trim();
    const name = String(body.name || "").trim();
    const manualLunar = String(body.lunarBirthdate || "").trim();
    const report = body.report || null;
    const question = String(body.question || "").trim();
    const analysisMode = String(body.analysis_mode || "today").trim();

    // ------------------------------------------
    // MODE: REPORT (生成命盤數據)
    // ------------------------------------------
    if (mode === "report") {
      const solarParts = parseDateStr(birthdate);
      if (!solarParts) return resp(200, { ok: false, error: "無效的生日格式" });

      // 1. 計算陽曆
      const solarResult = calcNumerology(solarParts.y, solarParts.m, solarParts.d, "+");
      
      // 2. 處理陰曆
      let lunarParts = null;
      let lunarStr = "未知";
      
      if (manualLunar) {
        lunarParts = parseDateStr(manualLunar);
        if(lunarParts) lunarStr = `${lunarParts.y}年${lunarParts.m}月${lunarParts.d}日`;
      } 
      
      if (!lunarParts) {
        const autoLunar = getLunarStruct(solarParts.y, solarParts.m, solarParts.d);
        if (autoLunar) {
          lunarParts = { y: autoLunar.y, m: autoLunar.m, d: autoLunar.d };
          lunarStr = autoLunar.str;
        }
      }

      // 3. 計算陰曆數據
      let lunarResult = { main: "??/??", soul: "?級", flowYear: "0", flowMonth: "0", flowDay: "0" };
      if (lunarParts) {
        const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
        const todayLunar = getLunarStruct(now.getFullYear(), now.getMonth()+1, now.getDate());
        
        if (todayLunar) {
           lunarResult = calcNumerologyWithTarget(
             lunarParts.y, lunarParts.m, lunarParts.d, 
             todayLunar.y, todayLunar.m, todayLunar.d, 
             "-"
           );
        } else {
           lunarResult = calcNumerology(lunarParts.y, lunarParts.m, lunarParts.d, "-");
        }
      }

      const parsed = {
        solarMain: solarResult.main,
        lunarMain: lunarResult.main,
        solarSoul: solarResult.soul,
        lunarSoul: lunarResult.soul,
        solarYear: solarResult.flowYear,
        solarMonth: solarResult.flowMonth,
        solarDay: solarResult.flowDay,
        lunarYear: lunarResult.flowYear,
        lunarMonth: lunarResult.flowMonth,
        lunarDay: lunarResult.flowDay,
      };

      const ov = computeOverallPercent(parsed);

      return resp(200, {
        ok: true,
        parsed: parsed,
        raw_result: `主命數 ${solarResult.main}, ${lunarResult.main}\n靈魂等級陽曆 ${solarResult.soul}\n靈魂等級陰曆 ${lunarResult.soul}\n`,
        overall_percent: ov.percent,
        overall_icon: ov.emoji,
        overall_label: ov.label,
        lunar_birthday_text: lunarStr,
        lunar_parsed: lunarParts 
      });
    }

    // ----------------------------
    // AI (OpenAI)
    // ----------------------------
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey) return resp(200, { text: "（小幫手這邊雲層偏厚，請檢查 API Key。）" });

    const system = `
你是「小幫手」。
你只根據外部提供的 report 回應，不得自行心算。
解析模式：${analysisMode}
語氣：溫暖、穩定、落地。
【重要格式規定】：
1. 請使用自然段落分段。
2. 嚴禁使用任何 Markdown 格式符號（如 **粗體**、## 標題）。
3. 保持純文字輸出，像寫信一樣。
`.trim();

    const userPrompt = mode === "qa"
        ? buildQaPrompt({ question, analysisMode })
        : buildReadingPrompt({ analysisMode });

    const text = await callOpenAIResponsesWithTimeout({
      apiKey, model, system, userPrompt,
      contextPack: { birthdate, name, report },
      timeoutMs: 25000,
    });

    return resp(200, { text });

  } catch (err) {
    console.error("[ai_reading] FAILED:", err);
    return resp(200, { text: "（系統忙碌中，請稍後再試。）" });
  }
};

// ==========================================
// 核心演算法 (保持不變)
// ==========================================
const LUNAR_DB = {
    1900: { new_year: '1900-01-31', code: '08|1100101101101' }, 1901: { new_year: '1901-02-19', code: '00|0100101011100' },
    1902: { new_year: '1902-02-08', code: '00|1010010101110' }, 1903: { new_year: '1903-01-29', code: '05|0101001001101' },
    1904: { new_year: '1904-02-16', code: '00|1101001001100' }, 1905: { new_year: '1905-02-04', code: '00|1101100101010' },
    1906: { new_year: '1906-01-25', code: '04|0110101010101' }, 1907: { new_year: '1907-02-13', code: '00|0101011010100' },
    1908: { new_year: '1908-02-02', code: '00|1001101011010' }, 1909: { new_year: '1909-01-22', code: '02|0100101011101' },
    1910: { new_year: '1910-02-10', code: '00|0100101011100' }, 1911: { new_year: '1911-01-30', code: '06|1010010011011' },
    1912: { new_year: '1912-02-18', code: '00|1010010011010' }, 1913: { new_year: '1913-02-06', code: '00|1101001001010' },
    1914: { new_year: '1914-01-26', code: '05|1101010100101' }, 1915: { new_year: '1915-02-14', code: '00|1011010101000' },
    1916: { new_year: '1916-02-03', code: '00|1101011010100' }, 1917: { new_year: '1917-01-23', code: '02|1001011011010' },
    1918: { new_year: '1918-02-11', code: '00|1001010110110' }, 1919: { new_year: '1919-02-01', code: '07|0100100110111' },
    1920: { new_year: '1920-02-20', code: '00|0100100101110' }, 1921: { new_year: '1921-02-08', code: '00|1010010010110' },
    1922: { new_year: '1922-01-28', code: '05|1011001001011' }, 1923: { new_year: '1923-02-16', code: '00|0110101001010' },
    1924: { new_year: '1924-02-05', code: '00|0110110101000' }, 1925: { new_year: '1925-01-24', code: '04|1010110110101' },
    1926: { new_year: '1926-02-13', code: '00|0010101101100' }, 1927: { new_year: '1927-02-02', code: '00|1001010101110' },
    1928: { new_year: '1928-01-23', code: '02|0100100101111' }, 1929: { new_year: '1929-02-10', code: '00|0100100101110' },
    1930: { new_year: '1930-01-30', code: '06|0110010010110' }, 1931: { new_year: '1931-02-17', code: '00|1101010010100' },
    1932: { new_year: '1932-02-06', code: '00|1110101001010' }, 1933: { new_year: '1933-01-26', code: '05|0110110101001' },
    1934: { new_year: '1934-02-14', code: '00|0101101011010' }, 1935: { new_year: '1935-02-04', code: '00|0010101101100' },
    1936: { new_year: '1936-01-24', code: '03|1001001101110' }, 1937: { new_year: '1937-02-11', code: '00|1001001011100' },
    1938: { new_year: '1938-01-31', code: '07|1100100101101' }, 1939: { new_year: '1939-02-19', code: '00|1100100101010' },
    1940: { new_year: '1940-02-08', code: '00|1101010010100' }, 1941: { new_year: '1941-01-27', code: '06|1101101001010' },
    1942: { new_year: '1942-02-15', code: '00|1011010101010' }, 1943: { new_year: '1943-02-05', code: '00|0101011010100' },
    1944: { new_year: '1944-01-25', code: '04|1010101011011' }, 1945: { new_year: '1945-02-13', code: '00|0010010111010' },
    1946: { new_year: '1946-02-02', code: '00|1001001011010' }, 1947: { new_year: '1947-01-22', code: '02|1100100101011' },
    1948: { new_year: '1948-02-10', code: '00|1010100101010' }, 1949: { new_year: '1949-01-29', code: '07|1011010010101' },
    1950: { new_year: '1950-02-17', code: '00|0110110010100' }, 1951: { new_year: '1951-02-06', code: '00|1011010101010' },
    1952: { new_year: '1952-01-27', code: '05|0101010110101' }, 1953: { new_year: '1953-02-14', code: '00|0100110110100' },
    1954: { new_year: '1954-02-03', code: '00|1010010110110' }, 1955: { new_year: '1955-01-24', code: '03|0101001010111' },
    1956: { new_year: '1956-02-12', code: '00|0101001010110' }, 1957: { new_year: '1957-01-31', code: '08|1010100101010' },
    1958: { new_year: '1958-02-18', code: '00|1110100101010' }, 1959: { new_year: '1959-02-08', code: '00|0110101010100' },
    1960: { new_year: '1960-01-28', code: '06|1010110101010' }, 1961: { new_year: '1961-02-15', code: '00|1010101101010' },
    1962: { new_year: '1962-02-05', code: '00|0100101101100' }, 1963: { new_year: '1963-01-25', code: '04|1010010101110' },
    1964: { new_year: '1964-02-13', code: '00|1010010101110' }, 1965: { new_year: '1965-02-02', code: '00|0101001001100' },
    1966: { new_year: '1966-01-21', code: '03|1110100100110' }, 1967: { new_year: '1967-02-09', code: '00|1101100101010' },
    1968: { new_year: '1968-01-30', code: '07|0101101010101' }, 1969: { new_year: '1969-02-17', code: '00|0101011010100' },
    1970: { new_year: '1970-02-06', code: '00|1011101001010' }, 1971: { new_year: '1971-01-27', code: '05|0100101011101' },
    1972: { new_year: '1972-02-15', code: '00|0100101011010' }, 1973: { new_year: '1973-02-03', code: '00|1010010011010' },
    1974: { new_year: '1974-01-23', code: '04|1101001001101' }, 1975: { new_year: '1975-02-11', code: '00|1101001001010' },
    1976: { new_year: '1976-01-31', code: '08|1101010100101' }, 1977: { new_year: '1977-02-18', code: '00|1011010101000' },
    1978: { new_year: '1978-02-07', code: '00|1011011010100' }, 1979: { new_year: '1979-01-28', code: '06|1001011011010' },
    1980: { new_year: '1980-02-16', code: '00|1001010110110' }, 1981: { new_year: '1981-02-05', code: '00|0100100110110' },
    1982: { new_year: '1982-01-25', code: '04|1010010010111' }, 1983: { new_year: '1983-02-13', code: '00|1010010010110' },
    1984: { new_year: '1984-02-02', code: '10|1011001001011' }, 1985: { new_year: '1985-02-20', code: '00|0110101001010' },
    1986: { new_year: '1986-02-09', code: '00|0110110101000' },
    1987: { new_year: '1987-01-29', code: '06|1010110110100' },
    1988: { new_year: '1988-02-17', code: '00|1010101101100' },
    1989: { new_year: '1989-02-06', code: '00|1001010101110' },
    1990: { new_year: '1990-01-27', code: '05|0100100101111' },
    1991: { new_year: '1991-02-15', code: '00|0100100101110' },
    1992: { new_year: '1992-02-04', code: '00|0110010010110' },
    1993: { new_year: '1993-01-23', code: '03|0110101001010' },
    1994: { new_year: '1994-02-10', code: '00|1110101001010' },
    1995: { new_year: '1995-01-31', code: '08|0110101100101' },
    1996: { new_year: '1996-02-19', code: '00|0101101011000' },
    1997: { new_year: '1997-02-07', code: '00|1010101101100' },
    1998: { new_year: '1998-01-28', code: '05|1001001101101' },
    1999: { new_year: '1999-02-16', code: '00|1001001011100' },
    2000: { new_year: '2000-02-05', code: '00|1100100101100' },
    2001: { new_year: '2001-01-24', code: '04|1101010010101' },
    2002: { new_year: '2002-02-12', code: '00|1101010010100' },
    2003: { new_year: '2003-02-01', code: '00|1101101001010' },
    2004: { new_year: '2004-01-22', code: '02|0101101010101' },
    2005: { new_year: '2005-02-09', code: '00|0101011010100' },
    2006: { new_year: '2006-01-29', code: '07|1010101011011' },
    2007: { new_year: '2007-02-18', code: '00|0010010111010' },
    2008: { new_year: '2008-02-07', code: '00|1001001011010' },
    2009: { new_year: '2009-01-26', code: '05|1100100101011' },
    2010: { new_year: '2010-02-14', code: '00|1010100101010' },
    2011: { new_year: '2011-02-03', code: '00|1011010010100' },
    2012: { new_year: '2012-01-23', code: '04|1011010101010' },
    2013: { new_year: '2013-02-10', code: '00|1010110101010' },
    2014: { new_year: '2014-01-31', code: '09|0101010110101' },
    2015: { new_year: '2015-02-19', code: '00|0100101110100' },
    2016: { new_year: '2016-02-08', code: '00|1010010110110' },
    2017: { new_year: '2017-01-28', code: '06|0101001010111' },
    2018: { new_year: '2018-02-16', code: '00|0101001010110' },
    2019: { new_year: '2019-02-05', code: '00|1010100100110' },
    2020: { new_year: '2020-01-25', code: '04|0111010010101' },
    2021: { new_year: '2021-02-12', code: '00|0110101010100' },
    2022: { new_year: '2022-02-01', code: '00|1010110101010' },
    2023: { new_year: '2023-01-22', code: '02|0100110110101' },
    2024: { new_year: '2024-02-10', code: '00|0100101101100' },
    2025: { new_year: '2025-01-29', code: '06|1010010101110' },
    2026: { new_year: '2026-02-17', code: '00|1010010011100' },
    2027: { new_year: '2027-02-06', code: '00|1101001001100' },
    2028: { new_year: '2028-01-26', code: '05|1110100100110' },
    2029: { new_year: '2029-02-13', code: '00|1101010100110' },
    2030: { new_year: '2030-02-03', code: '00|0101101010100' },
    2031: { new_year: '2031-01-23', code: '03|0110110101000' },
    2032: { new_year: '2032-02-11', code: '00|0010101101010' },
    2033: { new_year: '2033-01-31', code: '11|0100101011010' },
    2034: { new_year: '2034-02-19', code: '00|1010010101110' },
    2035: { new_year: '2035-02-08', code: '00|0101001001100' },
    2036: { new_year: '2036-01-28', code: '06|0111001001010' },
    2037: { new_year: '2037-02-15', code: '00|1110101001010' },
    2038: { new_year: '2038-02-04', code: '00|0110110100100' },
    2039: { new_year: '2039-01-24', code: '05|0101101010100' },
    2040: { new_year: '2040-02-12', code: '00|1001011011010' },
    2041: { new_year: '2041-02-01', code: '00|0100101011100' },
    2042: { new_year: '2042-01-22', code: '06|0100101011100' },
    2043: { new_year: '2043-02-10', code: '00|1010010011010' },
    2044: { new_year: '2044-01-30', code: '07|0101001001101' },
    2045: { new_year: '2045-02-17', code: '00|1101001001100' },
    2046: { new_year: '2046-02-06', code: '00|1101101001010' },
    2047: { new_year: '2047-01-26', code: '05|0101101010100' },
    2048: { new_year: '2048-02-14', code: '00|1001011010100' },
    2049: { new_year: '2049-02-02', code: '00|0100101011010' },
    2050: { new_year: '2050-01-23', code: '03|0100100111010' }
};

function sumDigits(n) {
  let sum = 0;
  String(n).split('').forEach(ch => sum += parseInt(ch, 10));
  return sum;
}

function calcPath(numVal, sign = "") {
  let temp = numVal;
  const steps = [temp];
  while (temp > 9) {
    temp = sumDigits(temp);
    steps.push(temp);
  }
  if (steps.length === 1) {
    steps.push(temp);
  }
  const formatted = steps.map((value, index) => index === 0 ? String(value).padStart(2, '0') : String(value));
  return { path: `${sign}${formatted.join('/')}`, main: temp };
}

function calcSoulLevelFull(year, month, day, sign = "") {
  const dateStr = String(year) + String(month).padStart(2,'0') + String(day).padStart(2,'0');
  const innateDigits = dateStr.split('').map(d => parseInt(d, 10));
  const total = innateDigits.reduce((a, b) => a + b, 0);
  const res = calcPath(total, sign);
  const pathStr = res.path;
  const mainNumber = res.main;
  const counts = {};
  innateDigits.forEach(d => counts[d] = (counts[d] || 0) + 1);
  const hasTriple = Object.values(counts).some(c => c >= 3);
  const innateSet = new Set(innateDigits);
  let ant1 = null, ant2 = null;
  if (total >= 10) {
    ant1 = Math.floor(total / 10);
    ant2 = total % 10;
  }
  const ant1_in = (ant1 !== null) && innateSet.has(ant1);
  const ant2_in = (ant2 !== null) && innateSet.has(ant2);
  const main_in = innateSet.has(mainNumber);
  let level = 1;
  if (ant1_in && ant2_in && main_in) level = hasTriple ? 6 : 7;
  else if (!ant1_in && ant2_in && main_in) level = 5;
  else if (!ant1_in && !ant2_in && main_in) level = 4;
  else if (ant1_in && ant2_in && !main_in) level = 3;
  else if (!ant1_in && ant2_in && !main_in) level = 2;
  else if (!ant1_in && !ant2_in && !main_in) level = 1;
  else if (ant1_in && !ant2_in && main_in) level = 5;
  else if (ant1_in && !ant2_in && !main_in) level = 2;
  return { main: pathStr, soul: level + "級" };
}

function getLunarStruct(sy, sm, sd) {
  let y = parseInt(sy, 10);
  const sDate = new Date(Date.UTC(y, sm - 1, sd));
  if (!LUNAR_DB[y]) return null;
  let info = LUNAR_DB[y];
  let nyDate = new Date(info.new_year + 'T00:00:00Z');
  let offset = Math.round((sDate - nyDate) / 86400000);
  if (offset < 0) {
    y -= 1;
    if (!LUNAR_DB[y]) return null;
    info = LUNAR_DB[y];
    nyDate = new Date(info.new_year + 'T00:00:00Z');
    offset = Math.round((sDate - nyDate) / 86400000);
  }
  const [leapStr, codes] = info.code.split('|');
  const leap = parseInt(leapStr, 10);
  let lm = 1;
  let isLeap = false;
  for (let i = 0; i < codes.length; i++) {
    const char = codes[i];
    const days = (char === '1') ? 30 : 29;
    if (offset < days) {
      const ld = offset + 1;
      return { y: y, m: lm, d: ld, str: `${y}年${isLeap?"閏":""}${lm}月${ld}日` };
    }
    offset -= days;
    if (leap > 0 && lm === leap && !isLeap) isLeap = true;
    else { if (isLeap) isLeap = false; lm++; }
  }
  return null;
}

function calcFlowsWithTarget(birthY, birthM, birthD, targetY, targetM, targetD, sign = "") {
  let fyBase = targetY;
  // 規則：今天月日 >= 生日月日 → 今年，否則 → 去年
  if (targetM < birthM || (targetM === birthM && targetD < birthD)) {
    fyBase = targetY - 1;
  }
  const fyStrRaw = String(fyBase) + String(birthM).padStart(2,'0') + String(birthD).padStart(2,'0');
  const fyRes = calcPath(sumDigits(fyStrRaw), sign);

  let fmBase = targetM;
  if (targetD < birthD) {
    fmBase = targetM - 1;
    if (fmBase === 0) fmBase = 12;
  }
  const fmStrRaw = String(fyBase) + String(fmBase).padStart(2,'0') + String(birthD).padStart(2,'0');
  const fmRes = calcPath(sumDigits(fmStrRaw), sign);

  const fdStrRaw = String(birthY) + String(birthM).padStart(2,'0') + String(targetD).padStart(2,'0');
  const fdRes = calcPath(sumDigits(fdStrRaw), sign);

  return { fy: fyRes.path, fm: fmRes.path, fd: fdRes.path, fyNum: fyRes.main };
}

function calcNumerology(y, m, d, sign) {
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
  return calcNumerologyWithTarget(y, m, d, now.getFullYear(), now.getMonth() + 1, now.getDate(), sign);
}

function calcNumerologyWithTarget(y, m, d, targetY, targetM, targetD, sign) {
  const soulRes = calcSoulLevelFull(y, m, d, sign);
  const flowRes = calcFlowsWithTarget(y, m, d, targetY, targetM, targetD, sign);
  return {
    main: soulRes.main,
    soul: soulRes.soul,
    flowYear: flowRes.fy,
    flowMonth: flowRes.fm,
    flowDay: flowRes.fd
  };
}

function resp(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
    body: JSON.stringify(obj),
  };
}
function safeJsonParse(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
function parseDateStr(s) {
  const raw = String(s).replace(/\D/g, "");
  if (raw.length < 8) return null;
  return { y: parseInt(raw.slice(0,4), 10), m: parseInt(raw.slice(4,6), 10), d: parseInt(raw.slice(6,8), 10) };
}
function computeOverallPercent(parsed){
  const day = avgScore(scoreFromPath(parsed.solarDay), scoreFromPath(parsed.lunarDay));
  const month = avgScore(scoreFromPath(parsed.solarMonth), scoreFromPath(parsed.lunarMonth));
  const year = avgScore(scoreFromPath(parsed.solarYear), scoreFromPath(parsed.lunarYear));
  const parts = [];
  if (day !== null) parts.push({ v: day, w: 0.40 });
  if (month !== null) parts.push({ v: month, w: 0.35 });
  if (year !== null) parts.push({ v: year, w: 0.25 });
  if (!parts.length) return { percent: null, emoji: "⛅️", label: "（等待更新）" };
  const wsum = parts.reduce((a,x)=>a+x.w, 0);
  const pct = Math.round(parts.reduce((a,x)=>a+x.v*x.w, 0) / wsum);
  const band = weatherBand(pct);
  return { percent: pct, emoji: band.emoji, label: band.label };
}
function scoreFromPath(s) {
  if(!s) return null;
  const parts = s.split('/');
  return baseScore(parseInt(parts[parts.length - 1].replace(/\D/g, ""), 10));
}
function baseScore(n){
  if ([1,4,6].includes(n)) return 82;
  if ([2,3,5].includes(n)) return 62;
  if ([7,9].includes(n)) return 48;
  if ([8,11,22].includes(n)) return 68;
  return 60;
}
function weatherBand(p){
  if (p >= 80) return { emoji:"☀️", label:"晴朗" };
  if (p >= 65) return { emoji:"⛅️", label:"多雲" };
  if (p >= 50) return { emoji:"🌥️", label:"陰偶陣雨" };
  if (p >= 35) return { emoji:"🌧️", label:"下雨" };
  return { emoji:"🌀", label:"颱風" };
}
function avgScore(a, b){
  const va = (typeof a === "number") ? a : null;
  const vb = (typeof b === "number") ? b : null;
  if (va === null && vb === null) return null;
  if (va === null) return vb;
  if (vb === null) return va;
  return Math.round((va + vb) / 2);
}
function buildQaPrompt({ question, analysisMode }){
  const q = String(question || "").trim();
  if(analysisMode === "core") return `請回應使用者問題。解析模式：主命數。以命盤為依據。\n${q}`;
  return `請回應使用者問題。參考整體能量氣象。\n${q}`;
}
function buildReadingPrompt({ analysisMode }){
  if(analysisMode === "core") return `請生成一段「陽曆／陰曆主命數分析」。`;
  return `請生成一段「今日能量解讀」。`;
}
async function callOpenAIResponsesWithTimeout({ apiKey, model, system, userPrompt, contextPack, timeoutMs }) {
  // [已修復] 使用正確的 Chat Completions API 結構
  const payload = {
    model: model, 
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt + "\nJSON:\n" + safeJSONStringify(contextPack) }
    ],
    temperature: 0.7
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // [已修復] 修正為正確的 OpenAI Endpoint
    const r = await fetch("https://api.openai.com/v1/chat/completions", { 
      method: "POST", 
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` }, 
      body: JSON.stringify(payload), 
      signal: ac.signal 
    });
    
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    
    // [已修復] 正確讀取回傳文字
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    }
    
    return "（訊號微弱，請重試。）";
  } catch (e) {
    if (e?.name === "AbortError") return "（小幫手逾時，請重試。）";
    throw e;
  } finally { clearTimeout(timer); }
}
function safeJSONStringify(obj) { try { return JSON.stringify(obj, null, 2); } catch { return "{}"; } }
