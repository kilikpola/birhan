import { useState, useEffect, useMemo } from "react";

/* ============================================================
   ብርሃን / BIRHAN — prototype v3

   Thesis: data is expensive, the network is not there, and the
   community already exists somewhere else. So:
     · Everything you READ is already on the phone.
     · Everything that costs megabytes says so, before it spends.
     · Birhan POSTS into the group. Birhan does not READ the group.

   Scope: 4 tabs. Bible · Mezmur · Today · More.
   No chat. No DMs. No directory. No quiz. No video. No iOS.

   New in v3:
     · Pastor admin, in-app (no separate web panel — pastors
       run their ministry from a phone).
     · Announcement replies — the bounded fallback for churches
       with no Telegram group. Not a chat: one thread per
       announcement, pastor can lock it, no DMs, no presence.
     · Telegram pairing card: verify / post / attribute. Privacy
       mode ON — the bot cannot see group conversation.

   Toggle the ⚙ header button to switch member ↔ pastor.
   Toggle the ⌕ header button to simulate losing signal.
   ============================================================ */

/* ---------- Ethiopian calendar (Amete Mihret) ---------- */
const ETH_MONTHS = ["መስከረም","ጥቅምት","ኅዳር","ታኅሣሥ","ጥር","የካቲት","መጋቢት","ሚያዝያ","ግንቦት","ሰኔ","ሐምሌ","ነሐሴ","ጳጉሜን"];
const ETH_MONTHS_LAT = ["Meskerem","Tikimt","Hidar","Tahsas","Tir","Yekatit","Megabit","Miyazia","Ginbot","Sene","Hamle","Nehase","Pagume"];

function toEthiopian(date) {
  const d = date.getDate(), m = date.getMonth() + 1, y = date.getFullYear();
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  const offset = jdn - 1723856;
  const r = ((offset % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor(offset / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

/* ---------- i18n ---------- */
const STR = {
  am: {
    today:"ዛሬ", bible:"መጽሐፍ ቅዱስ", mezmur:"መዝሙር", more:"ተጨማሪ", admin:"የአስተዳደር ገጽ",
    tToday:"ዛሬ", tBible:"መጽሐፍ", tMezmur:"መዝሙር", tMore:"ተጨማሪ",
    verseOfDay:"የዕለቱ ቃል", reflection:"ማሰላሰያ", continueReading:"ንባብ ቀጥል",
    downloaded:"ወርዷል", downloading:"እያወረደ...", onPhone:"በስልክዎ ላይ", offlineReady:"ያለ ኢንተርኔት ይሠራል",
    save:"አስቀምጥ", share:"አጋራ", amharic:"አማርኛ", english:"እንግሊዝኛ", both:"ሁለቱም",
    myChurch:"ቤተ ክርስቲያኔ", downloadsData:"ውርዶችና ዳታ", language:"ቋንቋ", nightMode:"የሌሊት ንባብ",
    about:"ስለ ብርሃን", dataUsed:"በዚህ ወር የወረደ", wifiOnly:"በWi-Fi ብቻ",
    announcement:"ማስታወቂያ", openTelegram:"በቴሌግራም ክፈት", replies:"መልሶች", writeReply:"መልስ ጻፉ",
    locked:"ውይይቱ ተዘግቷል", send:"ላክ",
    all:"ሁሉም", praise:"ምስጋና", worship:"አምልኮ", hymn:"መዝሙር",
    noSignal:"ኢንተርኔት የለም — የወረደው ይሠራል", pending:"ኢንተርኔት ሲመጣ ይላካል",
    newAnnouncement:"አዲስ ማስታወቂያ", post:"ላክ", telegramGroup:"የቴሌግራም ቡድን",
    members:"አባላት", verified:"ተረጋግጧል", notLinked:"አልተገናኘም",
  },
  en: {
    today:"Today", bible:"Holy Bible", mezmur:"Mezmur", more:"More", admin:"Pastor",
    tToday:"Today", tBible:"Bible", tMezmur:"Mezmur", tMore:"More",
    verseOfDay:"Verse of the day", reflection:"Reflection", continueReading:"Continue reading",
    downloaded:"Downloaded", downloading:"Downloading…", onPhone:"On your phone", offlineReady:"Works without internet",
    save:"Save", share:"Share", amharic:"Amharic", english:"English", both:"Both",
    myChurch:"My church", downloadsData:"Downloads & data", language:"Language", nightMode:"Night reading",
    about:"About Birhan", dataUsed:"Downloaded this month", wifiOnly:"Wi-Fi only",
    announcement:"Announcement", openTelegram:"Open in Telegram", replies:"Replies", writeReply:"Write a reply",
    locked:"Replies are closed", send:"Send",
    all:"All", praise:"Praise", worship:"Worship", hymn:"Hymn",
    noSignal:"No connection — downloaded content still works", pending:"Will send when you're online",
    newAnnouncement:"New announcement", post:"Post", telegramGroup:"Telegram group",
    members:"members", verified:"Verified", notLinked:"Not linked",
  },
};

/* ---------- Signature: Ethiopian hand cross ---------- */
const Cross = ({ size = 16, color = "currentColor", stroke = 1.4 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 2v20M4 8h16M7 5.2h10M7 10.8h10M9 16h6" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
    <circle cx="12" cy="8" r="2.6" stroke={color} strokeWidth={stroke} />
  </svg>
);

const Icon = ({ name, size = 20, color = "currentColor" }) => {
  const p = { width:size, height:size, viewBox:"0 0 24 24", fill:"none", stroke:color,
    strokeWidth:1.6, strokeLinecap:"round", strokeLinejoin:"round" };
  const paths = {
    book: <><path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22z" /><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /></>,
    note: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
    play: <path d="M7 4l13 8-13 8z" fill={color} stroke="none" />,
    pause: <path d="M8 4v16M16 4v16" strokeWidth="2.4" />,
    prev: <path d="M18 5v14L8 12zM6 5v14" />,
    next: <path d="M6 5v14l10-7zM18 5v14" />,
    down: <><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
    check: <path d="M4 12.5l5 5L20 6" />,
    wifiOff: <><path d="M2 2l20 20" /><path d="M8.5 16.5a5 5 0 017 0" /><path d="M5 12.9a10 10 0 0110-1.7" /></>,
    chevron: <path d="M9 5l7 7-7 7" />,
    back: <path d="M15 5l-7 7 7 7" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></>,
    church: <><path d="M12 2v6M9.5 5h5" /><path d="M4 21V11l8-4 8 4v10z" /><path d="M10 21v-5h4v5" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
    bookmark: <path d="M6 3h12v18l-6-5-6 5z" />,
    share: <><path d="M12 15V3" /><path d="M8 7l4-4 4 4" /><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" /></>,
    reply: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 016 6v5" /></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
    send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    eyeOff: <><path d="M2 2l20 20" /><path d="M10.6 6.2A9 9 0 0122 12a17 17 0 01-3 3.8" /><path d="M6.6 6.7A17 17 0 002 12a9.6 9.6 0 0013.3 4.3" /></>,
  };
  return <svg {...p}>{paths[name]}</svg>;
};

/* ---------- Content ----------
   PRODUCTION: Bible text from a LICENSED source (Bible Society of
   Ethiopia for Amharic), shipped as bundled SQLite — never fetched.
   English below is KJV: public domain, zero license cost.
   Mezmur: CHURCH-OWNED recordings only until artist licenses exist. */
const CHAPTER = {
  book: { am:"ዘፍጥረት", en:"Genesis" }, chapter: 1,
  testament: { am:"ብሉይ ኪዳን", en:"Old Testament" },
  verses: [
    { n:1, am:"በመጀመሪያ እግዚአብሔር ሰማይንና ምድርን ፈጠረ።", en:"In the beginning God created the heaven and the earth." },
    { n:2, am:"ምድርም ባዶ ነበረች፤ ጨለማም በጥልቁ ላይ ነበር።", en:"And the earth was without form, and void; and darkness was upon the face of the deep." },
    { n:3, am:"እግዚአብሔርም ብርሃን ይሁን አለ፤ ብርሃንም ሆነ።", en:"And God said, Let there be light: and there was light." },
    { n:4, am:"እግዚአብሔርም ብርሃኑ መልካም እንደ ሆነ አየ።", en:"And God saw the light, that it was good: and God divided the light from the darkness." },
  ],
};

const SONGS_SEED = [
  { id:1, am:"ስምህን አመሰግናለሁ", en:"I Praise Your Name", by:"Kale Hiwot Choir", len:"5:32", mb:2.4, cat:"praise", state:"on" },
  { id:2, am:"ታላቅ ነህ", en:"You Are Great", by:"Bole Youth Choir", len:"4:18", mb:1.9, cat:"worship", state:"on" },
  { id:3, am:"የሰማይ አባታችን", en:"Our Heavenly Father", by:"Mekane Yesus Choir", len:"6:01", mb:2.8, cat:"hymn", state:"off" },
  { id:4, am:"ክብር ለአንተ", en:"Glory to You", by:"Hawassa Praise Team", len:"4:45", mb:2.1, cat:"praise", state:"off" },
  { id:5, am:"ይቅር በለኝ", en:"Forgive Me", by:"Mulu Wongel Choir", len:"5:12", mb:2.3, cat:"worship", state:"off" },
];

const ANN_SEED = [
  {
    id:"a1",
    title:{ am:"የእሁድ አገልግሎት 9:00 ጠዋት", en:"Sunday service, 9:00 AM" },
    body:"Youth Bible study moves to Thursday, 6:00 PM. Choir practice stays Saturday.",
    when:"2h", locked:false, postedToTelegram:true,
    replies:[
      { by:"Yonas T.", text:"Amen. Will the children's class also move?", when:"1h" },
      { by:"Pastor Dawit", text:"No — children's class stays Sunday.", when:"40m", pastor:true },
    ],
  },
  {
    id:"a2",
    title:{ am:"ሰሞን ጾም ይጀምራል", en:"Fasting season begins Monday" },
    body:"Prayer nights every evening at 7:00 during the fast.",
    when:"2d", locked:true, postedToTelegram:true, replies:[],
  },
];

/* ============================================================ */
export default function Birhan() {
  const [tab, setTab] = useState("today");
  const [lang, setLang] = useState("am");
  const [night, setNight] = useState(false);
  const [online, setOnline] = useState(true);
  const [role, setRole] = useState("member");        // member | pastor
  const [openAnn, setOpenAnn] = useState(null);      // announcement id or null
  const [anns, setAnns] = useState(ANN_SEED);
  const [tg, setTg] = useState({ linked:true, members:84, name:"Kale Hiwot · Bole" });

  const t = STR[lang];
  const am = lang === "am";
  const eth = useMemo(() => toEthiopian(new Date()), []);
  const ethDate = am
    ? `${ETH_MONTHS[eth.month - 1]} ${eth.day} ፣ ${eth.year}`
    : `${ETH_MONTHS_LAT[eth.month - 1]} ${eth.day}, ${eth.year}`;

  const titles = { today:t.today, bible:t.bible, mezmur:t.mezmur, more:t.more, admin:t.admin };
  const tabs = [
    { key:"today",  icon:"sun",   label:t.tToday },
    { key:"bible",  icon:"book",  label:t.tBible },
    { key:"mezmur", icon:"note",  label:t.tMezmur },
    { key:"more",   icon:"menu",  label:t.tMore },
  ];

  const current = anns.find((a) => a.id === openAnn);

  const addReply = (id, text) =>
    setAnns((s) => s.map((a) => a.id === id
      ? { ...a, replies:[...a.replies, { by:"Tigist H.", text, when:online ? "now" : "pending", pending:!online }] }
      : a));

  const toggleLock = (id) =>
    setAnns((s) => s.map((a) => (a.id === id ? { ...a, locked:!a.locked } : a)));

  const publish = (title, body) =>
    setAnns((s) => [{
      id:"a" + Date.now(), title:{ am:title, en:title }, body,
      when:"now", locked:false, postedToTelegram:tg.linked && online, replies:[],
      pending:!online,
    }, ...s]);

  return (
    <div className={`birhan ${night ? "night" : ""}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+Ethiopic:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap');

        .birhan {
          --ink:#22201C; --ink-soft:#5C564C; --ink-faint:#8C8477;
          --paper:#F4ECDD; --paper-2:#EBE1CD; --rule:#D8CBB0;
          --gold:#A9761F; --mural:#9C3125; --indigo:#2B4460; --moss:#4E6B4A;
          --shadow:0 1px 0 rgba(34,32,28,.06), 0 8px 24px -18px rgba(34,32,28,.5);
          --am:'Noto Serif Ethiopic',serif; --en:'EB Garamond',Georgia,serif; --ui:'Inter',-apple-system,sans-serif;
          max-width:420px; margin:0 auto; min-height:100vh; background:var(--paper);
          color:var(--ink); font-family:var(--ui); display:flex; flex-direction:column; position:relative;
        }
        .birhan.night {
          --ink:#E7DFCF; --ink-soft:#A79E8C; --ink-faint:#6E675A;
          --paper:#14120E; --paper-2:#1D1A14; --rule:#322D23;
          --gold:#D8A64A; --mural:#C4564A; --indigo:#6E90B4; --moss:#7FA079;
          --shadow:0 8px 24px -18px #000;
        }
        .birhan *{box-sizing:border-box;margin:0;padding:0}
        .birhan button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
        .birhan input,.birhan textarea{font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--rule);border-radius:3px;padding:10px 12px;width:100%;outline:none}
        .birhan input:focus,.birhan textarea:focus{border-color:var(--gold)}
        .birhan ::-webkit-scrollbar{width:0}
        .am{font-family:var(--am)} .en{font-family:var(--en)}

        .top{display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;position:sticky;top:0;z-index:20;background:var(--paper)}
        .top h1{font-size:19px;font-weight:700}
        .top .sub{font-size:11px;color:var(--ink-faint);letter-spacing:.8px;text-transform:uppercase}
        .topacts{display:flex;gap:14px;align-items:center;color:var(--ink-soft)}
        .topacts .on{color:var(--gold)}

        .seal{display:inline-flex;align-items:center;gap:6px;padding:4px 9px 4px 7px;border-radius:999px;border:1px solid var(--rule);color:var(--gold);font-size:10.5px;font-weight:600;background:var(--paper-2)}
        .offlinebar{display:flex;align-items:center;gap:8px;justify-content:center;background:var(--indigo);color:#F4ECDD;font-size:11.5px;padding:7px 12px;font-weight:500}
        .birhan.night .offlinebar{color:#14120E}
        .scroll{flex:1;overflow-y:auto;padding:4px 18px 96px}

        .manuscript{background:var(--paper-2);border:1px solid var(--rule);border-radius:4px;padding:22px 20px 18px;box-shadow:var(--shadow);position:relative}
        .manuscript::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;background:var(--gold);opacity:.55}
        .eyebrow{font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--gold);font-weight:700;display:flex;align-items:center;gap:7px}
        .versetext{font-size:19px;line-height:1.85;margin:12px 0 10px}
        .versetext.am{font-size:18px;line-height:2}
        .gloss{font-family:var(--en);font-style:italic;font-size:15px;color:var(--ink-soft);line-height:1.6}
        .ref{color:var(--gold);font-size:12px;font-weight:700;margin-top:12px}

        .divider{display:flex;align-items:center;gap:10px;margin:26px 0 14px;color:var(--rule)}
        .divider .line{flex:1;height:1px;background:var(--rule)}
        .divider .label{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-faint);font-weight:600}

        .row{display:flex;align-items:center;gap:13px;padding:13px 14px;border:1px solid var(--rule);border-radius:4px;background:var(--paper-2);margin-bottom:8px;text-align:left;width:100%}
        .row .grow{flex:1;min-width:0}
        .row .title{font-size:14.5px;font-weight:600}
        .row .meta{font-size:11.5px;color:var(--ink-faint);margin-top:2px}
        .row .gloss2{font-size:12px;color:var(--ink-soft);font-family:var(--en)}

        .thumb{width:42px;height:42px;border-radius:3px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1px solid var(--rule);background:var(--paper);color:var(--gold)}
        .thumb.filled{background:var(--gold);border-color:var(--gold);color:var(--paper)}

        .chip{font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:999px;border:1px solid var(--rule);color:var(--ink-faint);white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
        .chip.on{color:var(--moss);border-color:var(--moss)}
        .chip.warn{color:var(--mural);border-color:var(--mural)}

        .pills{display:flex;gap:7px;overflow-x:auto}
        .pill{padding:7px 14px;border-radius:999px;border:1px solid var(--rule);font-size:12.5px;font-weight:600;color:var(--ink-soft);white-space:nowrap}
        .pill.active{background:var(--ink);color:var(--paper);border-color:var(--ink)}

        .seg{display:flex;border:1px solid var(--rule);border-radius:3px;overflow:hidden}
        .seg button{flex:1;padding:9px 0;font-size:12.5px;font-weight:600;color:var(--ink-soft)}
        .seg button.active{background:var(--ink);color:var(--paper)}

        .verse{padding:9px 6px;border-radius:3px;cursor:pointer;display:block;width:100%;text-align:left}
        .verse.hl{background:rgba(169,118,31,.14);box-shadow:inset 2px 0 0 var(--gold)}
        .vnum{color:var(--gold);font-size:11px;font-weight:700;vertical-align:super;margin-right:6px}

        .meter{height:3px;background:var(--rule);border-radius:2px;overflow:hidden}
        .meter>div{height:100%;background:var(--gold)}

        .btn{background:var(--ink);color:var(--paper);padding:11px 16px;border-radius:3px;font-size:13.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%}
        .btn.ghost{background:none;border:1px solid var(--rule);color:var(--ink)}
        .btn:disabled{opacity:.45}

        .reply{border-left:2px solid var(--rule);padding:8px 0 8px 12px;margin-bottom:10px}
        .reply .who{font-size:12px;font-weight:700}
        .reply .who.pastor{color:var(--gold)}
        .reply .txt{font-size:13.5px;line-height:1.6;color:var(--ink-soft);font-family:var(--en);margin-top:2px}

        .player{position:fixed;bottom:62px;left:50%;transform:translateX(-50%);width:100%;max-width:420px;background:var(--paper-2);border-top:1px solid var(--rule);padding:9px 16px 10px;z-index:30}
        .playbtn{width:38px;height:38px;border-radius:50%;background:var(--ink);color:var(--paper);display:flex;align-items:center;justify-content:center;flex-shrink:0}

        .tabbar{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:420px;background:var(--paper);border-top:1px solid var(--rule);display:flex;z-index:40;padding-bottom:env(safe-area-inset-bottom,0)}
        .tabbtn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 0 10px;color:var(--ink-faint);position:relative}
        .tabbtn.active{color:var(--ink)}
        .tabbtn .lab{font-size:10px;font-weight:600;font-family:var(--am)}
        .tabbtn .mark{position:absolute;top:2px;color:var(--gold)}

        .note{font-size:11px;color:var(--ink-faint);line-height:1.55;margin-top:12px}
        @media (prefers-reduced-motion:no-preference){.row,.pill,.verse{transition:background .18s,color .18s}}
      `}</style>

      <div className="top">
        <div>
          {current ? (
            <button onClick={() => setOpenAnn(null)} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Icon name="back" size={18} />
              <span className={am ? "am" : ""} style={{ fontSize:17, fontWeight:700 }}>{t.announcement}</span>
            </button>
          ) : (
            <>
              <h1 className={am ? "am" : ""}>{titles[tab]}</h1>
              {tab === "today" && <div className="sub">{ethDate}</div>}
            </>
          )}
        </div>
        <div className="topacts">
          <button onClick={() => setOnline(!online)} title="simulate connection">
            <Icon name={online ? "search" : "wifiOff"} size={19} />
          </button>
          <button
            className={role === "pastor" ? "on" : ""}
            onClick={() => { setRole(role === "pastor" ? "member" : "pastor"); setTab("today"); setOpenAnn(null); }}
            title="switch role"
          >
            <Icon name="gear" size={19} />
          </button>
          <button onClick={() => setNight(!night)}><Icon name={night ? "sun" : "bookmark"} size={19} /></button>
          <button onClick={() => setLang(am ? "en" : "am")}>
            <span style={{ fontSize:12, fontWeight:700 }}>{am ? "EN" : "አማ"}</span>
          </button>
        </div>
      </div>

      {!online && (
        <div className="offlinebar">
          <Icon name="wifiOff" size={13} />
          <span className={am ? "am" : ""}>{t.noSignal}</span>
        </div>
      )}

      <div className="scroll">
        {current ? (
          <AnnDetail a={current} t={t} lang={lang} role={role} online={online}
            onReply={(txt) => addReply(current.id, txt)} onLock={() => toggleLock(current.id)} />
        ) : (
          <>
            {tab === "today" && (
              role === "pastor"
                ? <Admin t={t} lang={lang} online={online} tg={tg} setTg={setTg} anns={anns}
                    publish={publish} openAnn={setOpenAnn} />
                : <Today t={t} lang={lang} go={setTab} anns={anns} openAnn={setOpenAnn} />
            )}
            {tab === "bible"  && <Bible t={t} lang={lang} />}
            {tab === "mezmur" && <Mezmur t={t} lang={lang} online={online} />}
            {tab === "more"   && <More t={t} lang={lang} night={night} setNight={setNight} role={role} />}
          </>
        )}
      </div>

      <div className="tabbar">
        {tabs.map((tb) => (
          <button key={tb.key} className={`tabbtn ${tab === tb.key && !current ? "active" : ""}`}
            onClick={() => { setTab(tb.key); setOpenAnn(null); }} aria-current={tab === tb.key}>
            {tab === tb.key && !current && <span className="mark"><Cross size={7} /></span>}
            <Icon name={tb.icon} size={20} />
            <span className="lab">{tb.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Today (member) ---------- */
function Today({ t, lang, go, anns, openAnn }) {
  const [open, setOpen] = useState(false);
  const am = lang === "am";
  return (
    <>
      <div className="manuscript" style={{ marginTop:8 }}>
        <div className="eyebrow">
          <Cross size={12} color="var(--gold)" />
          <span className={am ? "am" : ""}>{t.verseOfDay}</span>
        </div>
        <p className={`versetext ${am ? "am" : "en"}`}>
          {am ? "እግዚአብሔርም ብርሃን ይሁን አለ፤ ብርሃንም ሆነ።" : "And God said, Let there be light: and there was light."}
        </p>
        {am && <p className="gloss">Let there be light: and there was light.</p>}
        <div className="ref">{am ? "ዘፍጥረት ፩፥፫" : "Genesis 1:3"}</div>
        {open && (
          <div style={{ marginTop:16, paddingTop:16, borderTop:"1px solid var(--rule)" }}>
            <p style={{ fontSize:14, lineHeight:1.75, color:"var(--ink-soft)", fontFamily:"var(--en)" }}>
              Light is the first thing God speaks into a formless world. Before order, before life — light.
              Whatever is unformed in you this morning, He begins the same way.
            </p>
            <div style={{ display:"flex", gap:8, marginTop:14 }}>
              <button className="chip" style={{ padding:"7px 12px" }}><Icon name="share" size={13} /> {t.share}</button>
              <button className="chip" style={{ padding:"7px 12px" }}><Icon name="bookmark" size={13} /> {t.save}</button>
            </div>
          </div>
        )}
        <button onClick={() => setOpen(!open)} className={am ? "am" : ""}
          style={{ marginTop:12, fontSize:12, fontWeight:700, color:"var(--gold)" }}>
          {open ? "—" : `${t.reflection} →`}
        </button>
      </div>

      <div className="divider"><span className="line" /><Cross size={11} color="var(--rule)" /><span className="line" /></div>

      <button className="row" onClick={() => go("bible")}>
        <div className="thumb filled"><Icon name="book" size={19} /></div>
        <div className="grow">
          <div className={`title ${am ? "am" : ""}`}>{t.continueReading}</div>
          <div className="meta">{am ? "ዘፍጥረት ፩" : "Genesis 1"} · 4 / 31</div>
          <div className="meter" style={{ marginTop:7 }}><div style={{ width:"13%" }} /></div>
        </div>
        <span className="seal"><Cross size={10} /> {t.onPhone}</span>
      </button>

      <button className="row" onClick={() => go("mezmur")}>
        <div className="thumb"><Icon name="play" size={15} /></div>
        <div className="grow">
          <div className="title am">ስምህን አመሰግናለሁ</div>
          <div className="gloss2">I Praise Your Name · Kale Hiwot Choir</div>
        </div>
        <span className="chip on"><Icon name="check" size={10} /> {t.downloaded}</span>
      </button>

      <div className="divider"><span className="label">{t.announcement}</span><span className="line" /></div>

      {anns.map((a) => (
        <button key={a.id} className="row" style={{ display:"block" }} onClick={() => openAnn(a.id)}>
          <div className={`title ${am ? "am" : ""}`} style={{ marginBottom:4 }}>
            {am ? a.title.am : a.title.en}
          </div>
          <p style={{ fontSize:13, lineHeight:1.6, color:"var(--ink-soft)", fontFamily:"var(--en)" }}>{a.body}</p>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:11 }}>
            <span className="meta">Kale Hiwot · Bole · {a.when}</span>
            <span className="chip">
              {a.locked ? <><Icon name="lock" size={10} /> {t.locked}</>
                        : <><Icon name="reply" size={10} /> {a.replies.length} {t.replies}</>}
            </span>
          </div>
        </button>
      ))}

      <p className="note">
        Announcements are stored on your phone and readable with no connection. Discussion happens in your
        church's Telegram group, or in the replies here if your church has no group.
      </p>
    </>
  );
}

/* ---------- Announcement detail + bounded reply thread ---------- */
function AnnDetail({ a, t, lang, role, online, onReply, onLock }) {
  const [txt, setTxt] = useState("");
  const am = lang === "am";
  const send = () => { if (txt.trim()) { onReply(txt.trim()); setTxt(""); } };

  return (
    <>
      <div className="manuscript" style={{ marginTop:8 }}>
        <div className="eyebrow"><Cross size={12} color="var(--gold)" /><span>Kale Hiwot · Bole</span></div>
        <h2 className={am ? "am" : ""} style={{ fontSize:19, fontWeight:700, margin:"10px 0 8px", lineHeight:1.5 }}>
          {am ? a.title.am : a.title.en}
        </h2>
        <p style={{ fontFamily:"var(--en)", fontSize:15.5, lineHeight:1.7, color:"var(--ink-soft)" }}>{a.body}</p>
        <div style={{ display:"flex", gap:6, marginTop:14, flexWrap:"wrap" }}>
          <span className="chip"><Icon name="check" size={10} /> {t.onPhone}</span>
          {a.postedToTelegram && <span className="chip on">Posted to Telegram</span>}
          {a.pending && <span className="chip warn">{t.pending}</span>}
        </div>
      </div>

      {a.postedToTelegram && (
        <button className="btn ghost" style={{ marginTop:12 }}>
          {t.openTelegram} <Icon name="chevron" size={14} />
        </button>
      )}

      <div className="divider">
        <span className="label">{t.replies} · {a.replies.length}</span><span className="line" />
        {role === "pastor" && (
          <button className={`chip ${a.locked ? "warn" : ""}`} onClick={onLock}>
            <Icon name="lock" size={10} /> {a.locked ? "Unlock" : "Lock"}
          </button>
        )}
      </div>

      {a.replies.map((r, i) => (
        <div key={i} className="reply">
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <span className={`who ${r.pastor ? "pastor" : ""}`}>{r.by}{r.pastor ? " · Pastor" : ""}</span>
            <span style={{ fontSize:11, color:"var(--ink-faint)" }}>{r.when}</span>
          </div>
          <p className="txt">{r.text}</p>
        </div>
      ))}

      {a.locked ? (
        <div className="row" style={{ justifyContent:"center", color:"var(--ink-faint)" }}>
          <Icon name="lock" size={14} />
          <span className={`${am ? "am" : ""}`} style={{ fontSize:12.5 }}>{t.locked}</span>
        </div>
      ) : (
        <div style={{ marginTop:14 }}>
          <textarea rows={3} value={txt} onChange={(e) => setTxt(e.target.value)}
            placeholder={t.writeReply} className={am ? "am" : ""} />
          <button className="btn" style={{ marginTop:8 }} onClick={send} disabled={!txt.trim()}>
            <Icon name="send" size={14} /> {online ? t.send : t.pending}
          </button>
        </div>
      )}

      <p className="note">
        One thread per announcement. No direct messages, no presence, no read receipts. The pastor can close
        replies at any time. Replies written offline are queued and sent when you reconnect.
      </p>
    </>
  );
}

/* ---------- Bible ---------- */
function Bible({ t, lang }) {
  const [view, setView] = useState("am");
  const [hl, setHl] = useState(new Set());
  const toggle = (n) => { const s = new Set(hl); s.has(n) ? s.delete(n) : s.add(n); setHl(s); };

  return (
    <>
      <div style={{ display:"flex", gap:8, margin:"8px 0 14px" }}>
        <span className="seal"><Cross size={10} /> {t.offlineReady}</span>
        <span className="chip">0 MB · bundled</span>
      </div>

      <div className="seg" style={{ marginBottom:14 }}>
        {[{ k:"am", l:t.amharic, f:1 }, { k:"en", l:t.english }, { k:"both", l:t.both }].map((o) => (
          <button key={o.k} className={`${view === o.k ? "active" : ""} ${o.f ? "am" : ""}`}
            onClick={() => setView(o.k)}>{o.l}</button>
        ))}
      </div>

      <div className="row" style={{ marginBottom:14 }}>
        <div className="grow">
          <div className="title am" style={{ fontSize:17 }}>
            {lang === "am" ? CHAPTER.book.am : CHAPTER.book.en} {CHAPTER.chapter}
          </div>
          <div className="meta">{lang === "am" ? CHAPTER.testament.am : CHAPTER.testament.en}</div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button className="thumb" style={{ width:32, height:32 }}><Icon name="back" size={14} /></button>
          <button className="thumb" style={{ width:32, height:32 }}><Icon name="chevron" size={14} /></button>
        </div>
      </div>

      <div className="manuscript">
        {CHAPTER.verses.map((v) => (
          <button key={v.n} className={`verse ${hl.has(v.n) ? "hl" : ""}`} onClick={() => toggle(v.n)}>
            <span className="vnum">{v.n}</span>
            {(view === "am" || view === "both") && (
              <span className="am" style={{ fontSize:17, lineHeight:2 }}>{v.am}</span>
            )}
            {view === "both" && <br />}
            {(view === "en" || view === "both") && (
              <span className="en" style={{
                fontSize: view === "both" ? 14 : 16, lineHeight:1.7,
                color: view === "both" ? "var(--ink-soft)" : "var(--ink)",
                fontStyle: view === "both" ? "italic" : "normal",
              }}>{v.en}</span>
            )}
          </button>
        ))}
      </div>

      <p className="note">
        Amharic text requires a license from the Bible Society of Ethiopia. English shown is KJV (public domain).
        The whole Bible is ~4 MB of SQLite bundled in the APK — zero network reads, ever. Highlights are written
        locally and sync when you're next online.
      </p>
    </>
  );
}

/* ---------- Mezmur ---------- */
function Mezmur({ t, lang, online }) {
  const [songs, setSongs] = useState(SONGS_SEED);
  const [cat, setCat] = useState("all");
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(28);
  const [wifiOnly, setWifiOnly] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setPos((p) => (p >= 100 ? 0 : p + 0.4)), 120);
    return () => clearInterval(i);
  }, [playing]);

  const dl = (id) => {
    setSongs((s) => s.map((x) => (x.id === id ? { ...x, state:"loading" } : x)));
    setTimeout(() => setSongs((s) => s.map((x) => (x.id === id ? { ...x, state:"on" } : x))), 1400);
  };

  const cats = [{ k:"all", l:t.all }, { k:"praise", l:t.praise }, { k:"worship", l:t.worship }, { k:"hymn", l:t.hymn }];
  const shown = songs.filter((s) => cat === "all" || s.cat === cat);
  const mb = songs.filter((s) => s.state === "on").reduce((a, b) => a + b.mb, 0);
  const song = songs[cur];

  return (
    <>
      <div className="row" style={{ marginTop:8, background:"var(--paper)" }}>
        <div className="grow">
          <div className={`meta ${lang === "am" ? "am" : ""}`} style={{ marginTop:0 }}>{t.dataUsed}</div>
          <div style={{ fontSize:15, fontWeight:700, marginTop:2 }}>{mb.toFixed(1)} MB</div>
        </div>
        <button className={`chip ${wifiOnly ? "on" : ""}`} onClick={() => setWifiOnly(!wifiOnly)} style={{ padding:"6px 10px" }}>
          {wifiOnly && <Icon name="check" size={10} />} {t.wifiOnly}
        </button>
      </div>

      <div className="pills" style={{ margin:"14px 0" }}>
        {cats.map((c) => (
          <button key={c.k} className={`pill ${cat === c.k ? "active" : ""} ${lang === "am" ? "am" : ""}`}
            onClick={() => setCat(c.k)}>{c.l}</button>
        ))}
      </div>

      {shown.map((s) => {
        const i = songs.findIndex((x) => x.id === s.id);
        const isCur = i === cur;
        return (
          <div key={s.id} className="row" style={isCur ? { borderColor:"var(--gold)" } : undefined}>
            <button className={`thumb ${isCur ? "filled" : ""}`} disabled={s.state !== "on"}
              onClick={() => { setCur(i); setPlaying(true); setPos(0); }}
              style={{ opacity: s.state === "on" ? 1 : .45 }}>
              <Icon name={isCur && playing ? "pause" : "play"} size={15} />
            </button>
            <div className="grow">
              <div className="title am">{s.am}</div>
              <div className="gloss2">{s.en}</div>
              <div className="meta">{s.by} · {s.len} · {s.mb} MB</div>
            </div>
            {s.state === "on" && <span className="chip on"><Icon name="check" size={10} /></span>}
            {s.state === "off" && (
              <button className="chip" onClick={() => dl(s.id)} disabled={wifiOnly && !online} style={{ padding:"6px 9px" }}>
                <Icon name="down" size={12} /> {s.mb} MB
              </button>
            )}
            {s.state === "loading" && <span className="chip">{t.downloading}</span>}
          </div>
        );
      })}

      <p className="note">
        Church-owned recordings only. Commercial mezmur needs a license from the artist — Birhan does not
        redistribute what it cannot license. Audio is Opus 48 kbps: ~2 MB for a five-minute song. Every
        download states its cost before it spends your data.
      </p>

      <div className="player">
        <div className="meter" style={{ marginBottom:9 }}><div style={{ width:`${pos}%` }} /></div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div className="thumb filled" style={{ width:36, height:36 }}><Icon name="note" size={15} /></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div className="am" style={{ fontSize:13.5, fontWeight:600 }}>{song.am}</div>
            <div style={{ fontSize:11, color:"var(--ink-faint)" }}>{song.by} · {t.downloaded}</div>
          </div>
          <button style={{ color:"var(--ink-soft)" }}><Icon name="prev" size={17} /></button>
          <button className="playbtn" onClick={() => setPlaying(!playing)}>
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
          <button style={{ color:"var(--ink-soft)" }}><Icon name="next" size={17} /></button>
        </div>
      </div>
    </>
  );
}

/* ---------- Pastor admin (in-app, phone-first) ---------- */
function Admin({ t, lang, online, tg, setTg, anns, publish, openAnn }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const am = lang === "am";
  const post = () => { if (title.trim()) { publish(title.trim(), body.trim()); setTitle(""); setBody(""); } };

  return (
    <>
      <div className="manuscript" style={{ marginTop:8 }}>
        <div className="eyebrow"><Cross size={12} color="var(--gold)" />
          <span className={am ? "am" : ""}>{t.newAnnouncement}</span></div>
        <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={am ? "ርዕስ" : "Title"} className={am ? "am" : ""} />
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={am ? "ዝርዝር" : "Details"} className={am ? "am" : ""} />
        </div>
        <div style={{ display:"flex", gap:6, margin:"12px 0", flexWrap:"wrap" }}>
          <span className="chip on"><Icon name="check" size={10} /> Push to 84 members</span>
          {tg.linked
            ? <span className="chip on"><Icon name="check" size={10} /> Also post to Telegram</span>
            : <span className="chip warn">No Telegram group</span>}
          {!online && <span className="chip warn">{t.pending}</span>}
        </div>
        <button className="btn" onClick={post} disabled={!title.trim()}>
          <Icon name="send" size={14} /> {t.post}
        </button>
      </div>

      <div className="divider"><span className="label">{t.telegramGroup}</span><span className="line" /></div>

      {tg.linked ? (
        <div className="row" style={{ display:"block" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div className="thumb filled"><Icon name="church" size={18} /></div>
            <div className="grow">
              <div className="title">{tg.name}</div>
              <div className="meta">{tg.members} {t.members} · bot active</div>
            </div>
            <span className="chip on"><Icon name="check" size={10} /> {t.verified}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:7, marginTop:12,
            padding:"9px 11px", border:"1px solid var(--rule)", borderRadius:3, color:"var(--ink-faint)" }}>
            <Icon name="eyeOff" size={14} />
            <span style={{ fontSize:11.5, lineHeight:1.5 }}>
              Privacy mode is on. Birhan posts to your group. It cannot read what your members say.
            </span>
          </div>
          <button className="btn ghost" style={{ marginTop:10 }} onClick={() => setTg({ ...tg, linked:false })}>
            Unlink group
          </button>
        </div>
      ) : (
        <div className="row" style={{ display:"block" }}>
          <div className="title" style={{ marginBottom:6 }}>Link a Telegram group</div>
          <p style={{ fontSize:13, lineHeight:1.65, color:"var(--ink-soft)", fontFamily:"var(--en)" }}>
            Optional. Announcements already reach every member by push and work offline. A group only adds
            a place to talk — and saves you typing everything twice.
          </p>
          <ol style={{ margin:"12px 0 12px 18px", fontSize:12.5, lineHeight:1.9, color:"var(--ink-soft)" }}>
            <li>Telegram → New Group → add your members</li>
            <li>Add <b>@BirhanBot</b> to the group</li>
            <li>Paste the invite link below</li>
          </ol>
          <input placeholder="https://t.me/…" />
          <button className="btn" style={{ marginTop:8 }} onClick={() => setTg({ linked:true, members:84, name:"Kale Hiwot · Bole" })}>
            Verify group
          </button>
          <p className="note">
            No group? Members reply under each announcement instead. Nothing breaks.
          </p>
        </div>
      )}

      <div className="divider"><span className="label">Posted</span><span className="line" /></div>
      {anns.map((a) => (
        <button key={a.id} className="row" onClick={() => openAnn(a.id)}>
          <div className="grow">
            <div className={`title ${am ? "am" : ""}`}>{am ? a.title.am : a.title.en}</div>
            <div className="meta">
              {a.when} · {a.replies.length} {t.replies}{a.postedToTelegram ? " · on Telegram" : ""}
            </div>
          </div>
          {a.locked && <span className="chip warn"><Icon name="lock" size={10} /></span>}
          <Icon name="chevron" size={15} color="var(--ink-faint)" />
        </button>
      ))}
    </>
  );
}

/* ---------- More ---------- */
function More({ t, lang, night, setNight, role }) {
  const items = [
    { icon:"church", label:t.myChurch, value:"Kale Hiwot · Bole" },
    { icon:"down", label:t.downloadsData, value:"4.3 MB" },
    { icon:"globe", label:t.language, value: lang === "am" ? "አማርኛ" : "English" },
    { icon:"user", label:t.about, value:"v0.3" },
  ];
  return (
    <>
      <div className="row" style={{ marginTop:8 }}>
        <div className="thumb filled"><Icon name="user" size={19} /></div>
        <div className="grow">
          <div className="title">{role === "pastor" ? "Pastor Dawit Bekele" : "Tigist Hailu"}</div>
          <div className="meta">Kale Hiwot Church · Bole</div>
        </div>
        {role === "pastor" && <span className="chip on">Pastor</span>}
      </div>

      <div className="divider"><span className="line" /><Cross size={11} color="var(--rule)" /><span className="line" /></div>

      {items.map((i) => (
        <button key={i.label} className="row">
          <span style={{ color:"var(--gold)" }}><Icon name={i.icon} size={18} /></span>
          <span className={`grow title ${lang === "am" ? "am" : ""}`} style={{ fontWeight:500 }}>{i.label}</span>
          <span className="meta" style={{ marginTop:0 }}>{i.value}</span>
          <Icon name="chevron" size={15} color="var(--ink-faint)" />
        </button>
      ))}

      <button className="row" onClick={() => setNight(!night)}>
        <span style={{ color:"var(--gold)" }}><Icon name="sun" size={18} /></span>
        <span className={`grow title ${lang === "am" ? "am" : ""}`} style={{ fontWeight:500 }}>{t.nightMode}</span>
        <span className={`chip ${night ? "on" : ""}`}>{night ? "ON" : "OFF"}</span>
      </button>

      <div className="manuscript" style={{ marginTop:24, textAlign:"center" }}>
        <Cross size={18} color="var(--gold)" />
        <p className="am" style={{ fontSize:15, marginTop:8, lineHeight:1.9 }}>ሁልጊዜ በጌታ ደስ ይበላችሁ</p>
        <p className="gloss" style={{ fontSize:13, marginTop:4 }}>Rejoice in the Lord always — Philippians 4:4</p>
      </div>
    </>
  );
}
