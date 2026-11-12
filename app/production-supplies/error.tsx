'use client';
import Link from 'next/link';
export default function Error({ reset }: { reset: () => void }) { return <section><h1>Supply status unavailable</h1><p role="alert">We could not load the latest supply status.</p><button onClick={reset}>Try again</button><p><Link href="/production-supplies/settings">Check connections</Link></p></section>; }
