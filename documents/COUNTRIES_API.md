# `GET /api/public/countries` — Frontend Integration

Public endpoint for the active shipping/pricing country list. Written for the frontend team.

**Last updated:** August 7, 2026

---

## Endpoint

```
GET {API_BASE_URL}/api/public/countries
```

No auth, no headers, no query params. Returns every country the admin has marked active, sorted A→Z by name.

## Response

```json
{
  "success": true,
  "data": [
    {
      "id": "3f9a...",
      "code": "IN",
      "name": "India",
      "currencyCode": "INR",
      "flagUrl": "https://pub-xxxx.r2.dev/flags/uuid-india.png"
    },
    {
      "id": "7c21...",
      "code": "US",
      "name": "United States",
      "currencyCode": "USD",
      "flagUrl": "https://pub-xxxx.r2.dev/flags/uuid-usa.png"
    }
  ]
}
```

Everything sits under `data` — the whole API uses that envelope, so always read `json.data`, never `json` directly.

| Field | Use it for |
|---|---|
| `id` | Nothing user-facing. Only needed if you ever hit an endpoint that takes a `countryId`. |
| `code` | **The value you send back to the backend.** ISO 3166-1 alpha-2. This is what goes into `shippingCountry`. |
| `name` | The label you display. |
| `currencyCode` | ISO 4217. Use it to format prices (`INR` → ₹, `USD` → $). |
| `flagUrl` | Direct public URL. Drop it straight in `<img src>` — no signing, no auth, no transformation. |

An empty array is a valid response (no active countries configured yet). Handle it — don't assume at least one.

## Types

```ts
export type Country = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  flagUrl: string;
};

type ApiResponse<T> = {
  success: true;
  data: T;
  message?: string;
};
```

## Fetching

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

export async function fetchCountries(): Promise<Country[]> {
  const res = await fetch(`${API_BASE_URL}/api/public/countries`);

  if (!res.ok) {
    throw new Error(`Failed to load countries (${res.status})`);
  }

  const json: ApiResponse<Country[]> = await res.json();
  return json.data;
}
```

No `credentials: "include"` needed — this route is public and doesn't read the auth cookie.

### With React Query

Countries change maybe once a month. Cache aggressively:

```ts
export function useCountries() {
  return useQuery({
    queryKey: ["countries"],
    queryFn: fetchCountries,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
```

### With Next.js App Router

If you're rendering server-side, this is a good candidate for ISR rather than a client fetch:

```ts
const res = await fetch(`${API_BASE_URL}/api/public/countries`, {
  next: { revalidate: 3600 },
});
```

## Rendering a picker

```tsx
function CountrySelect({ value, onChange }: {
  value: string;
  onChange: (code: string) => void;
}) {
  const { data: countries, isLoading, isError } = useCountries();

  if (isLoading) return <SelectSkeleton />;
  if (isError) return <p>Couldn't load countries. Please refresh.</p>;
  if (!countries?.length) return <p>Shipping is not available right now.</p>;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a country</option>
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
```

Note the option `value` is `c.code`, not `c.id`. Native `<select>` can't render the flag image; if you want flags you need a custom dropdown:

```tsx
<button onClick={() => onChange(c.code)}>
  <img src={c.flagUrl} alt="" width={20} height={14} loading="lazy" />
  <span>{c.name}</span>
</button>
```

Keep `alt=""` on the flag — the country name is right beside it, so a screen reader announcing it twice is noise.

## Sending the selection back

The country code goes into the session update:

```ts
await fetch(`${API_BASE_URL}/api/public/sessions/${sessionId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    shippingCountry: selectedCode, // "IN", not the id, not "India"
    // ...other shipping fields
  }),
});
```

## Gotchas

- **Send the `code`, never the `name`.** Backend pricing lookup and Shiprocket routing both key off the ISO code.
- **Don't hardcode a country list as a fallback.** If this endpoint returns something, that's the definitive set the backend has pricing rules for. A hardcoded list will let a user pick a country the backend can't price and they'll fail at checkout.
- **Don't cache in `localStorage` indefinitely.** If an admin deactivates a country, a user with a stale cache can still select it. React Query's in-memory cache expiring on reload is the right level.
- **Prices are separate.** This endpoint gives you `currencyCode` for formatting, but the actual amount comes from the comic detail endpoint's pricing block. Don't try to derive price from here.

## Heads-up on the admin side

Right now there's no admin UI or endpoint to deactivate a country — `isActive` defaults to `true` and nothing writes to it. So today this endpoint returns the full country list. That will change once the toggle is added; build the frontend against the filtered contract, not against "it returns everything."

---

## Backend reference

| Piece | Location |
|---|---|
| Route | `src/routes/public.ts` |
| Handler | `getActiveCountriesHandler` in `src/controllers/country.controller.ts` |
| Service | `getActiveCountries()` in `src/services/country.service.ts` |
| Model | `Country` in `prisma/schema.prisma` |

The admin equivalent is `GET /api/admin/countries` (`getAllCountriesHandler`), which returns every country including deactivated ones plus the `isActive` field itself.
