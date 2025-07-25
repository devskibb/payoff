/* ------------- Debt‑vs‑DCA Simulator ------------- */
/* 2025‑07‑26 – linear ramp + optional volatility + required‑price/pay insight */

let topTokens = [];
let selectedToken = { id: "", symbol: "" };
let sigmaDynamic = 0.10; // updated dynamically

const tokenSearch = document.getElementById("tokenSearch");
const tokenList   = document.getElementById("tokenList");

window.addEventListener("DOMContentLoaded", fetchTopTokens);
tokenSearch.addEventListener("input", filterTokens);

function copy(buttonEl) {
    const id = buttonEl.getAttribute("data-copy-id");
    const text = document.getElementById(id).textContent.trim();
    navigator.clipboard.writeText(text);
  
    const tooltip = document.createElement("div");
    tooltip.className = "copy-tooltip";
    tooltip.innerText = "Copied!";
  
    const rect = buttonEl.getBoundingClientRect();
    tooltip.style.left = rect.left + window.scrollX + "px";
    tooltip.style.top = rect.top + window.scrollY - 30 + "px";
  
    document.body.appendChild(tooltip);
    requestAnimationFrame(() => {
      tooltip.style.opacity = 1;
      tooltip.style.transform = "translateY(-12px)";
    });
  
    setTimeout(() => {
      tooltip.style.opacity = 0;
      tooltip.style.transform = "translateY(-16px)";
      setTimeout(() => tooltip.remove(), 400);
    }, 1000);
  }
  

async function fetchTopTokens() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1"
    );
    topTokens = (await res.json()).map(t => ({ id: t.id, symbol: t.symbol.toUpperCase() }));
    renderTokenList("");
  } catch (err) {
    console.error("Failed to load top tokens", err);
  }
}

function renderTokenList(filter) {
  tokenList.innerHTML = "";
  topTokens
    .filter(t => t.symbol.includes(filter.toUpperCase()))
    .forEach(t => {
      const li = document.createElement("li");
      li.textContent = `${t.symbol} (${t.id})`;
      li.onclick = () => selectToken(t.id, t.symbol);
      tokenList.appendChild(li);
    });
}

function filterTokens() {
  const q = tokenSearch.value.trim();
  renderTokenList(q);
  if (isEvm(q) || isSol(q) || q.length >= 2) lookupToken(q);
}

function selectToken(id, symbol) {
  setSelectedToken(id, symbol);
  fetchPriceById(id);
}

const isEvm = v => /^0x[a-fA-F0-9]{40}$/.test(v);
const isSol = v => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const CHAINS = [
  "ethereum", "binance-smart-chain", "polygon-pos",
  "arbitrum-one", "optimistic-ethereum"
];

async function lookupToken(q) {
  const hit = await fetch(`https://api.coingecko.com/api/v3/search?query=${q}`)
    .then(r => r.json())
    .then(d => d.coins.find(c =>
      c.symbol.toLowerCase() === q.toLowerCase() ||
      c.id     .toLowerCase() === q.toLowerCase()
    ));
  if (hit) {
    setSelectedToken(hit.id, hit.symbol.toUpperCase());
    return fetchPriceById(hit.id);
  }

  if (isEvm(q)) {
    for (const chain of CHAINS) {
      const priceObj = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/${chain}` +
        `?contract_addresses=${q}&vs_currencies=usd`
      ).then(r => r.json());
      const price = Object.values(priceObj)[0]?.usd;
      if (price) {
        try {
          const meta = await fetch(
            `https://api.coingecko.com/api/v3/coins/${chain}/contract/${q}` +
            "?localization=false"
          ).then(r => r.json());
          setSelectedToken(meta.id, meta.symbol.toUpperCase());
        } catch {}
        return setStartPrice(price);
      }
    }
  } else if (isSol(q)) {
    const priceObj = await fetch(
      "https://api.coingecko.com/api/v3/simple/token_price/solana" +
      `?contract_addresses=${q}&vs_currencies=usd`
    ).then(r => r.json());
    const price = Object.values(priceObj)[0]?.usd;
    if (price) {
      try {
        const meta = await fetch(
          `https://api.coingecko.com/api/v3/coins/solana/contract/${q}` +
          "?localization=false"
        ).then(r => r.json());
        setSelectedToken(meta.id, meta.symbol.toUpperCase());
      } catch {}
      return setStartPrice(price);
    }
  }

  console.warn("No CoinGecko match for", q);
}

function setSelectedToken(id, symbol) {
  selectedToken = { id, symbol };
  if (symbol) tokenSearch.value = `${symbol} (${id})`;
  fetchHistoricalVolatility(id);
}

function setStartPrice(v) {
  document.getElementById("startPrice").value = v;
}

async function fetchPriceById(id) {
  try {
    const json = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    ).then(r => r.json());
    if (json[id]?.usd) setStartPrice(json[id].usd);

    if (!selectedToken.symbol) {
      const s = topTokens.find(t => t.id === id)?.symbol;
      if (s) return setSelectedToken(id, s);
      const meta = await fetch(
        `https://api.coingecko.com/api/v3/coins/${id}?localization=false`
      ).then(r => r.json());
      setSelectedToken(id, meta.symbol.toUpperCase());
    }
  } catch (err) {
    console.error("Failed to fetch price", err);
  }
}

async function fetchHistoricalVolatility(id) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30`
    );
    const json = await res.json();
    const prices = json.prices.map(p => p[1]);
    if (prices.length < 2) return;

    const logReturns = [];
    for (let i = 1; i < prices.length; i++) {
      const r = Math.log(prices[i] / prices[i - 1]);
      if (isFinite(r)) logReturns.push(r);
    }

    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / logReturns.length;
    sigmaDynamic = Math.sqrt(variance);
    console.log(`Updated σ: ${sigmaDynamic.toFixed(4)}`);
  } catch (err) {
    console.warn("Volatility fetch failed", err);
  }
}

function showDropdown() { tokenList.style.display = "block"; }
function hideDropdown() { setTimeout(() => tokenList.style.display = "none", 150); }

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

async function runSimulation() {
    const debt        = +document.getElementById("debtAmount").value;
    const apr         = +document.getElementById("apr").value;
    const pay         = +document.getElementById("monthlyPayment").value;
    const p0          = +document.getElementById("startPrice").value;
    const pT          = +document.getElementById("targetPrice").value;
    const targetDate  = new Date(document.getElementById("targetDate").value);
    const now         = new Date();
    const targetMonth = Math.max(1, Math.round((targetDate - now)/(1000*60*60*24*30)));
    const volMode     = document.getElementById("volMode").checked;
    const isDegen     = true; // always compound
  
    if (![debt, apr, pay, p0, pT].every(Number.isFinite))
      return alert("Fill all fields");
  
    const SYM         = selectedToken.symbol || "TOKENS";
    const monthlyRate = apr/12/100;
    const maxMonths   = Math.min(targetMonth, 240);
    const sigma       = sigmaDynamic;
  
    let remainingDebt = debt;
    let totalInterest = 0;
    let totalTokens   = 0;
    const debtData = [], dcaData = [], pricePath = [];
  
    for (let i=0; i<maxMonths; i++) {
      remainingDebt *= 1 + monthlyRate;
      totalInterest += (remainingDebt/(1+monthlyRate)) * monthlyRate;
      debtData.push(remainingDebt);
  
      let price = i < targetMonth
        ? p0 + ((pT - p0) * i / targetMonth)
        : pT;
      if (volMode) price *= Math.exp(sigma * randn());
      pricePath.push(price);
  
      totalTokens += pay / price;
      dcaData.push(totalTokens * price);
    }
  
    const months     = debtData.length;
    const finalValue = dcaData.at(-1);
    const crossover  = dcaData.findIndex((v,i)=>v >= debtData[i]) + 1 || null;
    const tokensNow  = totalTokens;
    const avgBuyPrice = pay * months / tokensNow;
    const tokensFromInterest = totalInterest / p0;
    const profitIfSold = finalValue - remainingDebt;
  
    let extraInsight = "";
    if (!crossover) {
      const reqPrice = remainingDebt / tokensNow;
      const priceFinal = pricePath[pricePath.length-1];
      const sumInv = pricePath.reduce((sum, pr) => sum + (1/pr), 0);
      const reqPay = remainingDebt / (priceFinal * sumInv);
  
      extraInsight = `
        <li>To cover all debt, ${SYM} must hit ~$${reqPrice.toFixed(2)} by month ${months}.</li>
        <li>Or DCA at least $${reqPay.toFixed(2)}/mo for this to break even.</li>
      `;
    }
  
    document.getElementById("results").innerHTML = `
      <h2>Results</h2>
      <div class="summary-block">
        <p><b>Debt:</b> Unpaid debt balloons to ~$${remainingDebt.toFixed(2)} after ${months} m.</p>
      </div>
      <div class="summary-block">
        <p><b>DCA Stack:</b> ~${tokensNow.toFixed(4)} ${SYM} ≈ $${finalValue.toFixed(2)}</p>
      </div>
      <h3>Insights</h3>
      <ul>
        ${crossover
          ? `<li>Your ${SYM} stack overtakes debt at month <b>${crossover}</b>.</li>`
          : `<li>Your ${SYM} stack never overtakes debt within ${months} m.</li>`}
        <li>You burn ~$${totalInterest.toFixed(2)} in interest — enough for ~${tokensFromInterest.toFixed(4)} ${SYM} at today's price.</li>
        <li>Average buy-in price: ~$${avgBuyPrice.toFixed(2)} per ${SYM}</li>
        <li>If sold at month ${months}, you ${profitIfSold >= 0 ? "profit" : "lose"} ~$${Math.abs(profitIfSold).toFixed(2)}</li>
        ${extraInsight}
      </ul>
    `;
  
    window.currentChart?.destroy();
    const ctx = document.getElementById("chart").getContext("2d");
    window.currentChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: Array.from({ length: months }, (_, i) => `M${i+1}`),
        datasets: [
          { label: "Debt Remaining", data: debtData, borderColor: "#e74c3c", tension: .3, pointRadius: 0 },
          { label: `${SYM} Stack Value`, data: dcaData, borderColor: "#2ecc71", tension: .3, pointRadius: 0 }
        ]
      },
      options: {
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: "#eee" } },
          tooltip: {
            callbacks: {
              afterBody: items => {
                const idx = items[0].dataIndex;
                const stack = dcaData[idx];
                const debtV = debtData[idx];
                if (stack > debtV) {
                  return [`Profit if sold: $${(stack - debtV).toFixed(2)}`];
                }
              }
            }
          }
        },
        scales: { x:{ ticks:{color:"#ccc"} }, y:{ ticks:{color:"#ccc"} } },
        hover: {
          mode: 'index',
          intersect: false,
          onHover: (e, items) => {
            e.native.target.style.cursor = items.length ? 'pointer' : 'default';
          }
        }
      }
    });
  }
  
