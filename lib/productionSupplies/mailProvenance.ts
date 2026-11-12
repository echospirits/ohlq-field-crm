type MessageHeader = { name: string; value: string };
const providerDomain = (domain: string) => domain === 'fx5.com' || domain === 'fx5solutions.com';
const envelopeDomain = (domain: string) => providerDomain(domain) || domain.endsWith('.fx5.com') || domain.endsWith('.fx5solutions.com');
function withoutComments(value: string) {
  let result = '', depth = 0, quoted = false, escaped = false;
  for (const character of value) {
    if (escaped) { if (!depth) result += character; escaped = false; continue; }
    if (character === '\\') { escaped = true; if (!depth) result += character; continue; }
    if (!depth && character === '"') quoted = !quoted;
    if (!quoted && character === '(') { depth++; continue; }
    if (!quoted && character === ')') { if (!depth) return ''; depth--; continue; }
    if (!depth) result += character;
  }
  return depth || quoted || escaped ? '' : result;
}

/** Recognize the provider, independently of claims in the untrusted subject/body. */
export function isVerifiedDx5WarningSender(headers: MessageHeader[]) {
  const from = headers.filter(header => header.name.toLowerCase() === 'from');
  if (from.length !== 1 || from[0].value.includes(',')) return false;
  const value = from[0].value.trim();
  const address = value.match(/^[^<>]*<([^<>\s]+@[^<>\s]+)>\s*$/)?.[1] || (/^[^<>\s]+@[^<>\s]+$/.test(value) ? value : '');
  const domain = address.split('@')[1]?.toLowerCase();
  if (domain !== 'fx5.com') return false;
  // Gmail prepends its own Authentication-Results. Never use a later sender-supplied result.
  const authentication = withoutComments(headers.find(header => header.name.toLowerCase() === 'authentication-results')?.value || '').replace(/\s+/g, ' ').trim();
  if (!/^mx\.google\.com\s*;/i.test(authentication)) return false;
  return authentication.split(';').slice(1).some(clause => {
    if (/^\s*spf=pass\b/i.test(clause)) {
      const property = clause.match(/\bsmtp\.mailfrom\s*=\s*(?:"([^"\\]*)"|([^\s";]+))/i);
      const mailFrom = property?.[1] ?? property?.[2];
      const domain = mailFrom?.match(/^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@([A-Za-z0-9.-]+)$/)?.[1];
      return Boolean(domain && envelopeDomain(domain.toLowerCase()));
    }
    if (/^\s*dkim=pass\b/i.test(clause)) {
      const signed = clause.match(/\bheader\.d\s*=\s*([^\s;]+)/i)?.[1] || clause.match(/\bheader\.i\s*=\s*[^\s;@]*@([^\s;]+)/i)?.[1];
      return Boolean(signed && (signed.toLowerCase() === domain || signed.toLowerCase().endsWith(`.${domain}`)));
    }
    return false;
  });
}
