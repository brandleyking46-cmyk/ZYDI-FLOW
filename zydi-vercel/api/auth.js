const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    const svcKey = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Server configuration error.' });

    const sb = createClient(url, key);
    const svc = createClient(url, svcKey);
    const { action, email, password, name, refresh_token } = req.body;

    if (action === 'login') {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: error.message });
      const { data: p } = await svc.from('profiles').select('status,is_admin,full_name').eq('id', data.user.id).single();
      if (p?.status === 'rejected') return res.status(403).json({ error: 'Your account was not approved. Contact your administrator.' });
      if (p?.status !== 'approved') return res.status(202).json({ pending: true });
      return res.status(200).json({ session: data.session, user: data.user, profile: p });
    }

    if (action === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
      if (error) return res.status(400).json({ error: error.message });
      // Notify admins
      try {
        const { data: admins } = await svc.from('profiles').select('id').eq('is_admin', true);
        if (admins?.length && process.env.VAPID_PUBLIC_KEY) {
          const webpush = require('web-push');
          webpush.setVapidDetails('mailto:hello@zydi.ai', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
          const { data: subs } = await svc.from('push_subscriptions').select('subscription').in('user_id', admins.map(a => a.id));
          for (const s of (subs || [])) {
            await webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify({ title: 'New signup 👤', body: `${name || email} wants access.`, icon: '/icon-192.png', url: '/admin.html' })).catch(() => {});
          }
        }
      } catch(e) {}
      return res.status(200).json({ pending: true });
    }

    if (action === 'refresh') {
      if (!refresh_token) return res.status(401).json({ error: 'No refresh token' });
      const { data, error } = await sb.auth.refreshSession({ refresh_token });
      if (error) return res.status(401).json({ error: error.message });
      const { data: p } = await svc.from('profiles').select('status,is_admin,full_name').eq('id', data.user.id).single();
      if (p?.status !== 'approved') return res.status(202).json({ pending: true });
      return res.status(200).json({ session: data.session, user: data.user, profile: p });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
