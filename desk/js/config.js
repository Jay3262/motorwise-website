// Motorwise Desk configuration.
// Live mode: paste your Supabase project URL and anon (public) key below.
// Leave them empty to run in SAMPLE MODE (data stays on this device only).
export const CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  // Web push (optional): the public VAPID key generated during setup.
  VAPID_PUBLIC_KEY: "",
  APP_NAME: "Motorwise Desk",
  // GitHub mode: used automatically when the Desk runs on these addresses.
  // Private records go to {owner}/{books} (private repo, created on first sign-in);
  // website stock goes to {owner}/{site} (the website repo, which Netlify publishes).
  GITHUB: { owner: "Jay3262", books: "motorwise-books", site: "motorwise-website", branch: "main",
    hosts: ["motorwisehereford.co.uk", "www.motorwisehereford.co.uk", "motorwise-hereford.netlify.app"],
    siteId: "motorwisehereford.co.uk", siteUrl: "https://motorwisehereford.co.uk" },
};

// Editable business defaults. These are copied into Admin > Business on first run
// and can be changed there at any time.
export const BUSINESS_DEFAULTS = {
  trading_name: "Motorwise Hereford",
  legal_name: "",            // to confirm: sole trader name or limited company
  phone: "07424 947219",
  whatsapp: "447424947219",
  email: "enquiries@motorwisehereford.co.uk",
  viewing_location: "Ramsden Road, Hereford HR2 6RQ (by appointment)",
  invoice_address: "",       // to confirm
  company_number: "",        // to confirm if limited
  vat_number: "",            // to confirm
  vat_treatment: "not_registered", // not_registered | margin_scheme | standard (accountant to confirm)
  website: "motorwisehereford.co.uk",
  invoice_prefix: "MW",
  next_invoice_number: 1001,
  aftercare_days: 14,
  overhead_allocation: "none", // none | per_sold_car
};
