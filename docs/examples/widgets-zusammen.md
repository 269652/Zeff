# Kredit-Rechner: drei Widgets arbeiten zusammen

Regler → Rechner → Anzeige. Ziehst du oben einen Regler, rechnet das mittlere Widget neu und das untere zeigt das Ergebnis.

:::app {"title":"1 · Regler"}
<div style="display:grid;gap:10px;max-width:480px">
  <label>Kreditsumme: <b id="av"></b> €<br><input id="a" type="range" min="1000" max="100000" step="1000" value="20000" style="width:100%"></label>
  <label>Zinssatz: <b id="rv"></b> % pro Jahr<br><input id="r" type="range" min="0" max="12" step="0.1" value="4" style="width:100%"></label>
  <label>Laufzeit: <b id="yv"></b> Jahre<br><input id="y" type="range" min="1" max="30" step="1" value="10" style="width:100%"></label>
</div>
<script>
  const ids = { a: "amount", r: "rate", y: "years" };
  const show = (k, v) => { document.getElementById(k + "v").textContent = v; };
  for (const k of Object.keys(ids)) {
    const el = document.getElementById(k);
    show(k, el.value);
    zeff.page.get(ids[k]).then((v) => { if (v != null) { el.value = v; show(k, v); } });
    el.oninput = () => { show(k, el.value); zeff.page.set(ids[k], Number(el.value)); };
  }
</script>
:::

:::app {"title":"2 · Rechner","prompt":"Berechnet die monatliche Rate aus den Reglern und veröffentlicht sie."}
<div id="out" style="font-size:18px">Warte auf die Regler …</div>
<script>
  const v = { amount: 20000, rate: 4, years: 10 };
  function calc() {
    const m = v.rate / 100 / 12, n = v.years * 12;
    const rate = m === 0 ? v.amount / n : (v.amount * m) / (1 - Math.pow(1 + m, -n));
    const total = rate * n;
    document.getElementById("out").innerHTML =
      "Monatliche Rate: <b>" + rate.toFixed(2) + " €</b><br>Gesamt: " + total.toFixed(0) + " € (Zinsen: " + (total - v.amount).toFixed(0) + " €)";
    // Zuerst den anderen Widgets Bescheid sagen (sofort), dann erst — gebündelt — für ganz Zeff veröffentlichen.
    zeff.emit("calculated", { rate, total, amount: v.amount });
    clearTimeout(timer);
    timer = setTimeout(() => {
      // (Ein Name gehört dem Widget, das ihn zuerst veröffentlicht hat — eine Ablehnung soll nichts kaputt machen.)
      const quiet = () => {};
      zeff.publish("Monatsrate", Math.round(rate * 100) / 100, { unit: "€", label: "Monatliche Kreditrate" }).catch(quiet);
      zeff.publish("Zinskosten", Math.round(total - v.amount), { unit: "€", label: "Zinsen insgesamt" }).catch(quiet);
    }, 400);
  }
  let timer;
  zeff.page.get().then((all) => { Object.assign(v, all || {}); calc(); });
  zeff.on("page", (e) => { v[e.key] = e.value; calc(); });
</script>
:::

:::app {"title":"3 · Anzeige"}
<div id="bar" style="height:28px;border-radius:6px;background:#e4e4e7;overflow:hidden;max-width:480px">
  <div id="fill" style="height:100%;width:0;background:#6366f1;transition:width .3s"></div>
</div>
<p id="t" style="margin:8px 0 0">Noch nichts berechnet.</p>
<script>
  function draw(d) {
    const share = Math.min(100, Math.round(((d.total - d.amount) / d.total) * 100));
    document.getElementById("fill").style.width = share + "%";
    document.getElementById("t").textContent = share + " % der Gesamtzahlung sind Zinsen (Rate " + d.rate.toFixed(2) + " €).";
  }
  zeff.on("calculated", draw);
  // Falls das Widget später geladen wird: der veröffentlichte Wert ist trotzdem da.
  zeff.values.get("Monatsrate").then((v) => { if (v != null && document.getElementById("t").textContent.startsWith("Noch")) document.getElementById("t").textContent = "Letzte Rate: " + v + " €"; });
</script>
:::

Die Werte „Monatsrate“ und „Zinskosten“ sind jetzt in ganz Zeff verfügbar, zum Beispiel in einer Ansicht als `{{ outputs.Monatsrate | euro }}`.
