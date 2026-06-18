const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error } = await svc.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
    const { data: me } = await svc.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!me?.is_admin) return res.status(403).json({ error: 'Admin access required' });

    if (req.method === 'GET') {
      const { data: profiles } = await svc.from('profiles').select('id,email,full_name,status,is_admin,created_at').order('created_at', { ascending: false });
      const { data: cc } = await svc.from('calls').select('user_id');
      const cm = {}; (cc || []).forEach(c => { cm[c.user_id] = (cm[c.user_id] || 0) + 1; });
      return res.status(200).json({ profiles: (profiles || []).map(p => ({ ...p, call_count: cm[p.id] || 0 })) });
    }

    const { action, userId } = req.body;
    if (action === 'approve') await svc.from('profiles').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', userId);
    else if (action === 'reject') await svc.from('profiles').update({ status: 'rejected' }).eq('id', userId);
    else if (action === 'revoke') await svc.from('profiles').update({ status: 'pending' }).eq('id', userId);
    else if (action === 'make_admin') await svc.from('profiles').update({ is_admin: true }).eq('id', userId);
    else return res.status(400).json({ error: 'Unknown action' });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
