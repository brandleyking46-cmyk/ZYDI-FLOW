const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error } = await svc.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
    const { callId } = req.body;
    await svc.from('calls').update({ followup_date: null }).eq('id', callId).eq('user_id', user.id);
    return res.status(200).json({ ok: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
