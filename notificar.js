import admin from 'firebase-admin';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

function local(tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const cols = await db.doc('data/users').listCollections();
let enviados = 0;
for (const col of cols) {
  try {
    const ps = await col.doc('push').get();
    if (!ps.exists) continue;
    const d = ps.data();
    const tokens = Array.isArray(d.tokens) ? d.tokens : [];
    if (!tokens.length) continue;
    let now;
    try { now = local(d.tz || 'America/Sao_Paulo'); } catch { now = local('America/Sao_Paulo'); }
    if (d.lastSent === now.date || now.time < (d.hour || '07:00')) continue;

    const cs = await col.doc('contents').get();
    const items = (cs.exists && cs.data().items) || [];
    let hoje = 0, atras = 0;
    const nomes = [];
    for (const c of items) for (const r of (c.reviews || [])) {
      if (r.done || !r.due || r.due > now.date) continue;
      if (r.due < now.date) atras++; else hoje++;
      if (nomes.length < 3 && !nomes.includes(c.title)) nomes.push(c.title);
    }
    const total = hoje + atras;
    if (!total) continue;

    const title = total === 1 ? '1 revisão para fazer' : `${total} revisões para fazer`;
    const body = (atras ? `${atras} atrasada${atras > 1 ? 's' : ''} · ` : '') + nomes.join(', ');
    const res = await admin.messaging().sendEachForMulticast({ tokens, data: { title, body }, webpush: { headers: { Urgency: 'high', TTL: '43200' } } });

    const mortos = tokens.filter((_, i) => {
      const e = res.responses[i].error;
      return e && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(e.code);
    });
    const upd = {};
    if (res.successCount) { upd.lastSent = now.date; enviados++; }
    if (mortos.length) upd.tokens = admin.firestore.FieldValue.arrayRemove(...mortos);
    if (Object.keys(upd).length) await col.doc('push').set(upd, { merge: true });
  } catch (e) {
    console.error('Erro em', col.id, e.message);
  }
}
console.log('Usuários notificados:', enviados);
