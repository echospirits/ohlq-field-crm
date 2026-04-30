'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export default function AccountsSearch({ initialQuery }: { initialQuery: string }) {
  const [value, setValue] = useState(initialQuery);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set('q', value.trim());
      else params.delete('q');
      router.replace(`${pathname}?${params.toString()}`);
    }, 220);

    return () => clearTimeout(timer);
  }, [value, searchParams, router, pathname]);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <label htmlFor="accountSearch">Search accounts</label>
      <input
        id="accountSearch"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type name, address, primary contact, phone..."
      />
      <p className="muted" style={{ margin: '8px 0 0 0' }}>Results update as you type.</p>
    </div>
  );
}