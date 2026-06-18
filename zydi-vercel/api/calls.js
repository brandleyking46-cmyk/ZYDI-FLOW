const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error } = await svc.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session' });

    const { data: profile } = await svc.from('profiles').select('is_admin,full_name,status').eq('id', user.id).single();
    const isAdmin = profile?.is_admin || false;

    let q = svc.from('calls').select('*,profiles(full_name)').order('created_at', { ascending: false }).limit(500);
    if (!isAdmin) q = q.eq('user_id', user.id);
    const { data, error: e } = await q;
    if (e) throw e;

    return res.status(200).json({ calls: data || [], isAdmin, profile });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
