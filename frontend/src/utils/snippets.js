// Integration code shown in Admin > Sites. The panel URL defaults to where this dashboard is served.
export const panelUrl = () => (import.meta.env.VITE_PUBLIC_API_URL || window.location.origin).replace(/\/+$/, '');

export function snippets(site) {
  const url = `${panelUrl()}/api/v1/leads`;
  const key = site?.api_key || 'SITE_KEY_HERE';
  return [
    {
      id: 'html',
      label: 'HTML / JavaScript',
      note: 'The key is visible to visitors in browser code; it is protected only by the allowed origins and rate limits. Prefer server-side sending where possible.',
      code: `<!-- Hidden honeypot field inside your form (leave it empty): -->
<input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">

<script>
document.querySelector('#contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {
    type: 'inquiry', // or 'quote'
    name: ((f.get('first_name') || f.get('name') || '') + ' ' + (f.get('last_name') || '')).trim(),
    email: f.get('email'),
    phone: f.get('mobile'),
    subject: f.get('subject'),
    message: f.get('message'),
    website: f.get('website') || '' // honeypot
  };
  try {
    const res = await fetch('${url}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Key': '${key}' },
      body: JSON.stringify(body)
    });
    if (res.ok) { e.target.reset(); alert('Thank you! We will contact you soon.'); }
    else { alert('Please check the form and try again.'); }
  } catch { alert('Network error, please try again.'); }
});
<\/script>`,
    },
    {
      id: 'php',
      label: 'PHP / WordPress',
      note: 'Recommended: the key stays on your server.',
      code: `$resp = wp_remote_post('${url}', [
  'headers' => ['Content-Type' => 'application/json', 'X-Site-Key' => '${key}'],
  'body'    => wp_json_encode([
    'type'    => 'inquiry',
    'name'    => $name,
    'email'   => $email,
    'phone'   => $phone,
    'message' => $message,
    // any other field is kept automatically under "extra"
  ]),
  'timeout' => 10,
]);
$ok = !is_wp_error($resp) && wp_remote_retrieve_response_code($resp) === 201;`,
    },
    {
      id: 'node',
      label: 'Node / Next.js',
      note: 'Call this from a server route / API handler, never from client code. Keep the key in an environment variable.',
      code: `// e.g. app/api/contact/route.js  (process.env.LEADS_SITE_KEY = '${key}')
export async function POST(req) {
  const form = await req.json();
  const res = await fetch('${url}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Site-Key': process.env.LEADS_SITE_KEY },
    body: JSON.stringify({
      type: 'quote',
      name: form.name,
      email: form.email,
      phone: form.phone,
      message: form.message,
      website: form.website || '' // honeypot
    })
  });
  return Response.json({ ok: res.status === 201 }, { status: res.status === 201 ? 200 : 400 });
}`,
    },
  ];
}
