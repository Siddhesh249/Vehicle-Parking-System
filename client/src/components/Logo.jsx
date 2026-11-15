import { useId } from "react";

// Brand mark: a parking "P" badge with a subtle road stripe and wheel dot.
// Kept as inline SVG so it scales crisply and can animate on hover.
export default function Logo({ size = 36, className = "" }) {
  const gradientId = `parkwise-badge-${useId().replace(/:/g, "")}`;

  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Parkwise"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e25656" />
          <stop offset="1" stopColor="#a41f1f" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${gradientId})`} />
      <path
        d="M13 30V10h8.2c4.5 0 7.3 2.4 7.3 6.2 0 3.9-2.9 6.4-7.4 6.4H18V30h-5Zm5-8.2h2.7c1.9 0 2.9-.9 2.9-2.3 0-1.4-1-2.2-2.9-2.2H18v4.5Z"
        fill="#fff"
        fillRule="evenodd"
      />
      <rect x="10" y="32" width="20" height="2.4" rx="1.2" fill="#fff" opacity=".55" />
      <circle cx="30.5" cy="30.5" r="2.6" fill="#fff" opacity=".9" />
    </svg>
  );
}
