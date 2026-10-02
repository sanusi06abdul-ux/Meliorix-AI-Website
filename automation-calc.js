/*
 * Automation & AI Opportunity Calculator — shared logic.
 *
 * Single source of truth for formulas, assumptions, the recommendation library,
 * ranking and report rendering. Used in three places:
 *   - calculator/index.html (browser, instant result)
 *   - n8n "Validate & Calculate" Code node (server-side recalculation; embedded by build_n8n_workflow.js)
 *   - execution/create_calculator_sheet.py (dumps LIBRARY into the Recommendations tab via node)
 *
 * Rules: every number is deterministic. No LLM. Every figure is labelled an estimate.
 */
var AutomationCalc = (function () {
  "use strict";

  var CONFIG = {
    version: "1.1",
    weeksPerYear: 46,
    workingDaysPerWeek: 5,
    defaultOccurrencesPerDay: 3,
    scenarioLow: 0.2,
    scenarioHigh: 0.3,
    currency: "£",
    limits: {
      maxMinutesPerOccurrence: 480,   // 8 hours per single occurrence
      maxOccurrencesPerDay: 200,
      maxPeople: 250,
      maxHourlyCost: 500,
      maxWeeklyHoursPerPerson: 60     // sanity cap: workload per person per week
    }
  };

  var FREQUENCIES = {
    several_daily: { label: "Several times a day", perWeek: null, note: "occurrences per day × 5 working days" },
    daily:         { label: "Daily",               perWeek: 5,    note: "assumes 5 working days" },
    weekly:        { label: "Weekly",              perWeek: 1,    note: "one occurrence per week" },
    monthly:       { label: "Monthly",             perWeek: 0.23, note: "approx. 12 ÷ 52, an approximation" }
  };

  var OPTIONS = {
    business_type: {
      professional_services: "Professional services",
      agency: "Agency",
      ecommerce: "E-commerce",
      construction_trades: "Construction / trades",
      other: "Other SME"
    },
    team_size: { "1-5": "1–5", "6-20": "6–20", "21-50": "21–50", "51-250": "51–250" },
    processes: {
      lead_followup: "Lead follow-up",
      crm_data_entry: "CRM / data entry",
      onboarding: "Client onboarding",
      reporting: "Reporting",
      documents: "Documents & proposals",
      customer_support: "Customer support & enquiries",
      scheduling: "Scheduling, deadlines & follow-ups",
      marketing_ops: "Marketing operations",
      invoicing_admin: "Invoicing, renewals & admin"
    },
    frequency: {
      several_daily: "Several times a day", daily: "Daily", weekly: "Weekly", monthly: "Monthly"
    },
    manual_level: {
      manual: "Almost entirely manual",
      partial: "Some steps automated",
      mostly: "Mostly automated with gaps"
    },
    error_frequency: { frequently: "Frequently", occasionally: "Occasionally", rarely: "Rarely", not_sure: "Not sure" },
    problem_type: {
      slow: "Things take too long",
      dropped: "Things get missed or people feel ignored",
      both: "Both",
      not_sure: "Not sure"
    },
    tools_count: { "1-2": "1–2", "3-5": "3–5", "6+": "6+" },
    ai_tasks: {
      reading: "Reading long documents or emails to find what matters",
      writing: "Writing similar emails, proposals or documents from scratch",
      answering: "Answering the same questions from customers or staff",
      finding: "Searching old files, bids or notes for information",
      summarising: "Writing up calls, meetings or notes",
      researching: "Researching prospects, companies or the market",
      analysing: "Making sense of data, reviews or feedback",
      none: "None of these"
    },
    priority: {
      save_time: "Save time",
      reduce_errors: "Reduce errors",
      faster_leads: "Respond to leads faster",
      more_customers: "Handle more customers",
      better_reporting: "Improve reporting"
    }
  };

  var CASE_STUDIES = {
    membership: {
      title: "Membership lifecycle, fully automated with no AI",
      summary: "A membership organisation with 5 subscription tiers re-issued tickets, chased activations and tracked cancellations by hand. Six connected rules-based workflows now run the full lifecycle (purchase → activation reminder → renewal reminder → automatic ticket reissue → cancellation sync) with no manual input.",
      quote: "He finds the problem and quickly resolves it, while explaining what, how, and why he took certain actions — without adding extra workload to your process.",
      attribution: "J. Kevin, Founder of Thrichbrims"
    },
    partnership_radar: {
      title: "Partnership Radar: daily market monitoring",
      summary: "A sponsorship agency founder spent hours each morning scanning dozens of publications for partnership news. An n8n pipeline now collects the sources, uses one AI step to filter for genuine announcements, and sends a daily email.",
      quote: "Before this I was spending 6–8 hours weekly looking for partnership news. Now I receive a daily email informing me of the activity going on within the sponsorship market, allowing me to capture high-intent leads looking to activate sponsorships.",
      attribution: "Founder, Sports Sponsorship Agency"
    }
  };

  // Recommendation library. Mirrored to the Recommendations tab in Google Sheets for reference.
  var LIBRARY = [
    {
      id: "lead_followup",
      title: "Automated lead follow-up and nurture",
      processes: ["lead_followup", "marketing_ops"],
      priorities: ["faster_leads", "more_customers"],
      problem_types: ["dropped", "slow"],
      revenue_linked: true,
      symptoms: "Leads wait hours or days for a reply; follow-ups depend on someone remembering; no consistent sequence from enquiry to purchase.",
      workflow: "Form or quiz submission → lead created in CRM → routed to the right owner → instant acknowledgement → reminder tasks and approved follow-up messages at each stage.",
      triggers: "New form/quiz submission, new enquiry email, stage change in CRM.",
      integrations: "Website forms, HubSpot / Pipedrive, Gmail / Outlook, Slack, n8n.",
      prerequisites: "A defined lead stage list and agreed follow-up messages; access to the form and CRM.",
      complexity: "Low–Medium",
      benefits: "Faster first response, fewer leads forgotten, a consistent sales process.",
      risks: "Respect consent and channel rules (UK GDPR / PECR); a named person keeps ownership of each lead.",
      human_review: "A person approves the message templates and handles replies.",
      next_step: "Map what happens in the first 48 hours after an enquiry today, and where leads stall.",
      case_study: null
    },
    {
      id: "onboarding",
      title: "Client onboarding with automatic chasing",
      processes: ["onboarding"],
      priorities: ["more_customers", "save_time", "faster_leads"],
      problem_types: ["slow", "dropped"],
      revenue_linked: true,
      symptoms: "Every new client means the same setup steps by hand; onboarding stalls while waiting for forms or documents; nobody is reminded when they are late.",
      workflow: "Signed/paid → client record created → welcome email and forms sent → checklist and tasks for the team → automatic reminders if forms are not returned → completion notified.",
      triggers: "Proposal signed, payment received, deal marked won.",
      integrations: "Forms (Tally / Typeform), CRM, Google Drive, e-signature tool, Gmail, project tool (Asana / ClickUp).",
      prerequisites: "A written onboarding checklist and the documents/forms each client needs.",
      complexity: "Medium",
      benefits: "Clients start sooner, fewer stalled onboardings, the team stops chasing by hand.",
      risks: "Sensitive documents and exceptions may need review; account and access setup in third-party tools may not have an API.",
      human_review: "A person reviews submitted documents and approves exceptions.",
      next_step: "List every step from 'yes' to 'fully onboarded', and mark where you are waiting on the client.",
      case_study: null
    },
    {
      id: "crm_sync",
      title: "Stop re-keying data between systems",
      processes: ["crm_data_entry", "invoicing_admin", "lead_followup"],
      priorities: ["save_time", "reduce_errors"],
      problem_types: ["slow", "dropped"],
      revenue_linked: false,
      symptoms: "The same information is copied between forms, spreadsheets, CRM and accounting tools; records go out of date or get duplicated.",
      workflow: "Source event (form, sale, email) → validate and de-duplicate → create/update the record in the system of record → sync the agreed fields to other tools → flag anything that fails validation.",
      triggers: "New submission, new order, record updated.",
      integrations: "CRM, Google Sheets / Airtable, Xero / QuickBooks, e-commerce platform, n8n.",
      prerequisites: "Agree which system is the 'source of truth' for each field; check data quality and duplicate rules.",
      complexity: "Low–Medium",
      benefits: "Less copy-paste, fewer errors, records stay current.",
      risks: "Bad source data gets copied faster, so check duplicate handling and field mapping first.",
      human_review: "A person checks records flagged by validation.",
      next_step: "Pick the one piece of data copied most often and trace every place it is typed.",
      case_study: null
    },
    {
      id: "doc_triage",
      title: "Document and proposal triage",
      processes: ["documents"],
      priorities: ["reduce_errors", "save_time"],
      problem_types: ["slow", "dropped"],
      revenue_linked: false,
      symptoms: "Long documents (RFPs, tenders, contracts, applications) are read in full just to decide whether they are relevant; disqualifying details are missed.",
      workflow: "Document arrives → key fields and criteria extracted → checked against your rules (e.g. insurance minimums, deadlines, budget) → summary and go/no-go flags sent to a reviewer → approval queue.",
      triggers: "New email attachment, file added to a folder, portal notification.",
      integrations: "Gmail / Outlook, Google Drive / SharePoint, AI extraction step, Sheets or CRM, Slack.",
      prerequisites: "A written list of your qualifying criteria and sample documents.",
      complexity: "Medium",
      benefits: "Faster go/no-go decisions; fewer wasted days on unsuitable work.",
      risks: "Extraction can be wrong, so low-confidence fields and consequential decisions need human review.",
      human_review: "A person makes the final go/no-go decision.",
      next_step: "Write down the 5–10 criteria you use to reject a document and collect 3 recent examples.",
      case_study: null
    },
    {
      id: "deadline_tracking",
      title: "Deadline and follow-up tracking across the team",
      processes: ["scheduling", "documents", "onboarding"],
      priorities: ["reduce_errors", "save_time"],
      problem_types: ["dropped"],
      revenue_linked: false,
      symptoms: "Deadlines live in contracts, emails and people's heads; follow-ups are tracked by hand and things slip.",
      workflow: "Contract/job created → key dates captured → added to the right people's calendars and task lists → reminders before each date → escalation if overdue.",
      triggers: "Contract signed, job booked, date field changed.",
      integrations: "Google Calendar / Outlook, project or task tool, CRM, Slack / Teams, e-signature tool.",
      prerequisites: "Agree who owns each type of deadline and how far ahead reminders are needed.",
      complexity: "Low–Medium",
      benefits: "Fewer missed deadlines, clear ownership, less mental load.",
      risks: "Dates extracted from documents must be checked; reminders are only useful if ownership is clear.",
      human_review: "A person confirms extracted dates before they go live.",
      next_step: "List the deadlines that have slipped in the last 3 months and where each one was recorded.",
      case_study: null
    },
    {
      id: "reporting_monitoring",
      title: "Automated reporting and source monitoring",
      processes: ["reporting", "marketing_ops"],
      priorities: ["better_reporting", "save_time"],
      problem_types: ["slow"],
      revenue_linked: false,
      symptoms: "Someone pulls numbers or news from several platforms every day or week and pastes them into a report.",
      workflow: "Scheduled run → collect data from each source → combine and calculate → flag anomalies → deliver as a dashboard, sheet or daily/weekly email digest.",
      triggers: "Schedule (e.g. 8am daily, Monday morning).",
      integrations: "Ad platforms, Google Analytics, Shopify, RSS / news feeds, Google Sheets / Looker Studio, Gmail, n8n.",
      prerequisites: "Read access to each data source and an agreed report layout.",
      complexity: "Low–Medium",
      benefits: "Reports arrive on time without manual effort; issues spotted earlier.",
      risks: "Verify source data, permissions and calculations before relying on the output.",
      human_review: "A person reviews flagged anomalies.",
      next_step: "Take your most recent manual report and list each number and where it came from.",
      case_study: "partnership_radar"
    },
    {
      id: "enquiry_handling",
      title: "Inbox triage and reply drafting",
      processes: ["customer_support", "lead_followup"],
      priorities: ["faster_leads", "more_customers", "save_time"],
      problem_types: ["slow", "dropped"],
      revenue_linked: true,
      symptoms: "Enquiries and replies pile up in a shared inbox; key details have to be copied out of emails by hand; response times vary.",
      workflow: "New email → classified (enquiry, support, reply, spam) → key details extracted to a sheet/CRM → routed to the right person → draft reply prepared → reminder if no response within your target time.",
      triggers: "New email in a shared inbox, new chat/form message.",
      integrations: "Gmail / Outlook, help desk, CRM or Sheets, Slack, AI classification step.",
      prerequisites: "Agreed categories, response-time targets and approved answers to common questions.",
      complexity: "Medium",
      benefits: "Faster, more consistent replies; nothing sits unanswered; details captured automatically.",
      risks: "Don't send sensitive or uncertain responses without approval.",
      human_review: "A person approves drafts before sending, at least at first.",
      next_step: "Export a week of inbound emails and tag them by type to see where the volume is.",
      case_study: null
    },
    {
      id: "billing_lifecycle",
      title: "Renewals, invoicing and admin reminders",
      processes: ["invoicing_admin", "scheduling"],
      priorities: ["save_time", "reduce_errors", "more_customers"],
      problem_types: ["dropped", "slow"],
      revenue_linked: true,
      symptoms: "Renewals, invoices, payment chasers and cancellations are handled by hand across several systems; customers fall through the gaps.",
      workflow: "Purchase/renewal event → records updated → reminders before renewal or due date → automatic re-issue of tickets/invoices → cancellations synced across every system.",
      triggers: "Payment received, renewal date approaching, cancellation submitted.",
      integrations: "Stripe / GoCardless, Xero / QuickBooks, ticketing or membership platform, Google Sheets, Gmail.",
      prerequisites: "A clear record of each customer's status and the rules for reminders and cancellations.",
      complexity: "Low–Medium",
      benefits: "Fewer missed renewals and late payments, one up-to-date record of who is active.",
      risks: "Payment and cancellation logic must be tested carefully; edge cases (refunds, pauses) need rules.",
      human_review: "A person handles disputes, refunds and exceptions.",
      next_step: "Write down the life of one customer from purchase to cancellation and note every manual touch.",
      case_study: "membership"
    }
  ];

  // Whether each automation idea needs AI at all. Honest positioning: many good automations need none.
  var APPROACH = {
    lead_followup: "Rules-based automation (AI optional for personalising messages)",
    onboarding: "Rules-based automation, no AI needed",
    crm_sync: "Rules-based automation, no AI needed",
    doc_triage: "Automation with one AI step (reading the document)",
    deadline_tracking: "Rules-based automation (AI optional to pull dates from documents)",
    reporting_monitoring: "Rules-based automation (AI optional to filter or summarise)",
    enquiry_handling: "Automation with one AI step (classifying and drafting)",
    billing_lifecycle: "Rules-based automation, no AI needed"
  };
  LIBRARY.forEach(function (r) { r.approach = APPROACH[r.id] || "Rules-based automation"; });

  // AI opportunity library: where AI (language models) adds judgement that rules alone can't.
  // Every item keeps a person in charge of consequential decisions.
  var AI_LIBRARY = [
    {
      id: "ai_doc_reader",
      title: "AI document reader: extract, check and summarise",
      ai_tasks: ["reading"],
      processes: ["documents", "onboarding", "invoicing_admin"],
      priorities: ["reduce_errors", "save_time"],
      what_ai_does: "Reads long documents (RFPs, tenders, contracts, applications, invoices), pulls out the key terms, dates and requirements, and flags anything that rules you out.",
      example: "A proposal arrives and, within minutes, the team gets a one-page summary: deadline, budget, insurance minimums, and a flag that the required certification has expired. Without that, it might have been days of work before anyone noticed.",
      tools: "Claude or ChatGPT API, n8n, Google Drive / SharePoint, Sheets or CRM.",
      human_role: "A person makes the go/no-go decision. The AI shows the exact passage for every flag so it can be checked.",
      data_needed: "5–10 recent example documents and your written qualifying criteria.",
      risks: "AI can misread or miss details, so low-confidence fields go to a person. Don't upload confidential documents to tools without a suitable data agreement.",
      complexity: "Medium",
      first_step: "Collect 3 recent documents you rejected, and write down why. Those reasons become the checklist the AI uses.",
      case_study: null
    },
    {
      id: "ai_inbox_assistant",
      title: "AI inbox assistant: sort, extract and draft replies",
      ai_tasks: ["answering", "reading"],
      processes: ["customer_support", "lead_followup", "marketing_ops"],
      priorities: ["faster_leads", "more_customers", "save_time"],
      what_ai_does: "Reads incoming emails, works out what each one is (new lead, question, complaint, reply), pulls out the key details into a sheet or CRM, and drafts a reply in your tone.",
      example: "An agency running outreach to thousands of people gets hundreds of replies. AI drafts each response and captures the key details (availability, rates, missing info) into a spreadsheet, so nobody has to copy them out by hand.",
      tools: "Gmail / Outlook, Claude or ChatGPT API, n8n, Sheets or CRM, Slack.",
      human_role: "A person approves drafts before they're sent, at least until trust is built. Sensitive or uncertain emails always go to a person.",
      data_needed: "A sample of past emails and your best replies to common questions.",
      risks: "Never auto-send sensitive, uncertain or complaint replies. Watch the tone, and keep a log of what was sent.",
      complexity: "Medium",
      first_step: "Export a week of inbound emails and tag each one by type. That shows which types are worth automating first.",
      case_study: null
    },
    {
      id: "ai_knowledge_assistant",
      title: "AI knowledge assistant for your own documents",
      ai_tasks: ["finding", "answering"],
      processes: ["documents", "customer_support", "onboarding"],
      priorities: ["save_time", "more_customers"],
      what_ai_does: "Lets your team (or customers) ask questions in plain English and get answers from your existing documents, past bids, policies and FAQs, with links to the source.",
      example: "Instead of asking 'didn't we write something like this for a client last year?', someone types the question and gets the relevant paragraph from a past bid, with a link to the file.",
      tools: "Claude or ChatGPT with retrieval, Google Drive / SharePoint / Notion, Slack or a simple web chat.",
      human_role: "Answers are suggestions with sources, and people check anything that goes to a customer. Someone owns keeping the documents current.",
      data_needed: "An organised folder of the documents worth searching (out-of-date files cause wrong answers).",
      risks: "Answers are only as good as the documents behind them. Access permissions must be respected so people only see what they're allowed to.",
      complexity: "Medium",
      first_step: "List the 20 questions your team asks each other most often, and where the answers currently live.",
      case_study: null
    },
    {
      id: "ai_first_drafts",
      title: "AI first drafts from your past work",
      ai_tasks: ["writing"],
      processes: ["documents", "marketing_ops", "lead_followup", "reporting"],
      priorities: ["save_time", "more_customers", "faster_leads"],
      what_ai_does: "Produces first drafts of proposals, quotes, emails, reports or posts using your past examples, tone and facts, so people start from 70% rather than a blank page.",
      example: "A proposal draft is assembled from the client's brief, your standard sections and your three most similar past proposals. The team then spends its time on the parts that win the work.",
      tools: "Claude or ChatGPT API, Google Docs / Word templates, n8n, your CRM.",
      human_role: "A person writes the final version. AI drafts and checks for gaps, but your judgement, pricing and promises stay human.",
      data_needed: "5–10 of your best past examples, plus your standard sections and facts.",
      risks: "Drafts can sound generic or state things that aren't true. Never send AI-written content without a person reading it.",
      complexity: "Low–Medium",
      first_step: "Pick the one document type you write most often and gather your 5 best examples.",
      case_study: null
    },
    {
      id: "ai_meeting_notes",
      title: "AI call and meeting notes straight into your systems",
      ai_tasks: ["summarising"],
      processes: ["crm_data_entry", "onboarding", "lead_followup", "customer_support"],
      priorities: ["save_time", "reduce_errors", "faster_leads"],
      what_ai_does: "Transcribes calls and meetings, writes a short summary with decisions and actions, and updates the CRM or project tool so nothing depends on someone's memory.",
      example: "After a sales call, the CRM record updates itself with the client's needs, budget and next step, a follow-up task is created, and a draft recap email is ready to send.",
      tools: "Fireflies / Otter / Teams or Zoom transcripts, Claude or ChatGPT API, n8n, CRM.",
      human_role: "A person checks the summary and recap before anything goes to the client.",
      data_needed: "Permission to record calls and an agreed list of the fields to capture.",
      risks: "Get consent before recording calls. Summaries can miss nuance, so keep the transcript linked.",
      complexity: "Low–Medium",
      first_step: "Choose one type of call (e.g. discovery calls) and list the 5–8 things you always need to capture from it.",
      case_study: null
    },
    {
      id: "ai_research_monitoring",
      title: "AI research and market monitoring",
      ai_tasks: ["researching", "reading"],
      processes: ["lead_followup", "reporting", "marketing_ops"],
      priorities: ["faster_leads", "better_reporting", "more_customers"],
      what_ai_does: "Watches news, websites, tender portals or social posts for you, filters out the noise, and sends a short daily digest of what matters, including new leads.",
      example: "A sponsorship agency founder used to spend 6–8 hours a week scanning publications. A daily email now lists only the genuine partnership announcements.",
      tools: "RSS / Google News / portal feeds, web scraping, Claude or ChatGPT API (one filtering step), n8n, Gmail.",
      human_role: "A person decides which items to act on, and the filtering rules are reviewed regularly.",
      data_needed: "The sources you check today and examples of what counts as relevant.",
      risks: "Sources change or block scraping. AI filters can miss items, so review a sample of what was rejected now and then.",
      complexity: "Low–Medium",
      first_step: "Write down every source you (or your team) check manually each week, and what you're looking for in it.",
      case_study: "partnership_radar"
    },
    {
      id: "ai_insights",
      title: "AI insights from reviews, feedback and data",
      ai_tasks: ["analysing"],
      processes: ["reporting", "customer_support", "marketing_ops"],
      priorities: ["better_reporting", "reduce_errors", "more_customers"],
      what_ai_does: "Reads customer reviews, survey answers, support tickets or report data, groups them into themes, spots changes, and explains them in plain English each week.",
      example: "Every Monday, a short note goes out: 'Delivery complaints up 30% this week, mostly about one courier. Three customers asked for a feature you don't offer yet.'",
      tools: "Review platforms, help desk, survey tools, Google Sheets, Claude or ChatGPT API, n8n.",
      human_role: "A person decides what to do about the themes. The numbers themselves come from your data, not the AI.",
      data_needed: "Access to where the feedback or data lives, and a few months of history.",
      risks: "The AI's explanations must be checked against the real numbers, and personal data in feedback must be handled properly.",
      complexity: "Low–Medium",
      first_step: "Export the last 3 months of reviews or tickets and decide what questions you want answered each week.",
      case_study: null
    },
    {
      id: "ai_lead_qualification",
      title: "AI lead research and qualification",
      ai_tasks: ["researching", "reading"],
      processes: ["lead_followup", "crm_data_entry"],
      priorities: ["faster_leads", "more_customers"],
      what_ai_does: "When a lead comes in, AI researches the company (website, size, sector), checks it against your ideal-customer criteria, and gives it a priority with a short reason.",
      example: "A new enquiry lands in the CRM already tagged 'High fit: 25-person agency, uses HubSpot, mentioned onboarding delays', so the best leads are called first.",
      tools: "Website forms, CRM, enrichment data, Claude or ChatGPT API, n8n.",
      human_role: "Scores guide priority but people decide. Nobody is rejected automatically.",
      data_needed: "Your ideal-customer criteria and examples of good and bad past leads.",
      risks: "Research can be wrong or out of date. Only use publicly available business information.",
      complexity: "Low–Medium",
      first_step: "Write down what makes a lead a great fit versus a poor one, using your last 10 customers.",
      case_study: null
    }
  ];

  var PROBLEM_NARRATIVE = {
    slow: "You said the main issue is speed. That usually points to hand-offs and manual steps that can run on their own.",
    dropped: "You said things get missed. That usually points to missing reminders, unclear ownership and information spread across systems. These are often the easiest problems to fix with automation.",
    both: "You said things are both slow and get missed. Fixing the hand-offs and adding reminders and ownership in the same workflow often helps with both.",
    not_sure: "You weren't sure whether the main issue is speed or things being missed. A short review of the process usually makes this clear."
  };

  // ---------- helpers ----------
  function round(n, dp) { var f = Math.pow(10, dp || 0); return Math.round(n * f) / f; }
  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = typeof v === "number" ? v : Number(String(v).replace(/[£,\s]/g, ""));
    return isFinite(n) ? n : NaN;
  }
  function str(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function bool(v) { return v === true || v === "true" || v === "on" || v === 1 || v === "1"; }
  function escapeHtml(s) {
    return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmt(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return "–";
    return Number(round(n, dp === undefined ? 1 : dp)).toLocaleString("en-GB");
  }
  function money(n) { return n === null || !isFinite(n) ? "–" : CONFIG.currency + fmt(n, 0); }
  function labelOf(group, key) { return (OPTIONS[group] && OPTIONS[group][key]) || key || "–"; }

  // ---------- validation ----------
  function validate(raw) {
    raw = raw || {};
    var errors = {};
    var a = {};
    var L = CONFIG.limits;

    function pick(field, group, required) {
      var v = str(raw[field]);
      if (!v) { if (required) errors[field] = "Please choose an option."; return ""; }
      if (!OPTIONS[group][v]) { errors[field] = "Unrecognised option."; return ""; }
      return v;
    }

    a.business_type = pick("business_type", "business_type", true);
    a.team_size = pick("team_size", "team_size", true);

    var procs = Array.isArray(raw.processes) ? raw.processes : str(raw.processes).split(",");
    a.processes = procs.map(str).filter(function (p) { return p && OPTIONS.processes[p]; });
    a.processes = a.processes.filter(function (p, i) { return a.processes.indexOf(p) === i; });
    if (!a.processes.length) errors.processes = "Choose at least one process.";

    a.primary_process = str(raw.primary_process) || (a.processes.length === 1 ? a.processes[0] : "");
    if (!a.primary_process || !OPTIONS.processes[a.primary_process]) errors.primary_process = "Choose one process to estimate.";
    else if (a.processes.indexOf(a.primary_process) === -1) a.processes.unshift(a.primary_process);

    a.frequency = pick("frequency", "frequency", true);

    a.occurrences_per_day = null;
    if (a.frequency === "several_daily") {
      var opd = num(raw.occurrences_per_day);
      if (opd === null) { opd = CONFIG.defaultOccurrencesPerDay; a.occurrences_per_day_defaulted = true; }
      if (isNaN(opd) || opd < 1) errors.occurrences_per_day = "Enter how many times a day (1 or more).";
      else if (opd > L.maxOccurrencesPerDay) errors.occurrences_per_day = "That seems very high. Please check the number (max " + L.maxOccurrencesPerDay + ").";
      a.occurrences_per_day = opd;
    }

    var dur = num(raw.duration);
    var unit = str(raw.duration_unit) === "hours" ? "hours" : "minutes";
    a.duration = dur; a.duration_unit = unit;
    if (dur === null) errors.duration = "Enter how long it takes each time.";
    else if (isNaN(dur) || dur <= 0) errors.duration = "Enter a number greater than zero.";
    a.minutes_per_occurrence = (dur && dur > 0) ? (unit === "hours" ? dur * 60 : dur) : null;
    if (a.minutes_per_occurrence && a.minutes_per_occurrence > L.maxMinutesPerOccurrence)
      errors.duration = "More than 8 hours per occurrence seems unlikely. Please check the number and unit.";

    var people = num(raw.people);
    if (people === null) errors.people = "Enter how many people do this (minimum 1).";
    else if (isNaN(people) || people < 1 || Math.floor(people) !== people) errors.people = "Enter a whole number, 1 or more.";
    else if (people > L.maxPeople) errors.people = "Enter a number up to " + L.maxPeople + ".";
    a.people = people;

    var cost = num(raw.hourly_cost);
    if (cost === null) a.hourly_cost = null; // optional — time value simply not shown
    else if (isNaN(cost) || cost <= 0) { errors.hourly_cost = "Enter a positive number, or leave it blank."; a.hourly_cost = null; }
    else if (cost > L.maxHourlyCost) { errors.hourly_cost = "Enter an hourly cost up to " + CONFIG.currency + L.maxHourlyCost + "."; a.hourly_cost = null; }
    else a.hourly_cost = cost;

    a.manual_level = pick("manual_level", "manual_level", true);
    a.error_frequency = pick("error_frequency", "error_frequency", true);
    a.problem_type = pick("problem_type", "problem_type", true);
    a.tools_count = pick("tools_count", "tools_count", true);
    a.priority = pick("priority", "priority", true);

    var tasks = Array.isArray(raw.ai_tasks) ? raw.ai_tasks : str(raw.ai_tasks).split(",");
    a.ai_tasks = tasks.map(str).filter(function (t, i, arr) { return t && OPTIONS.ai_tasks[t] && arr.indexOf(t) === i; });
    if (!a.ai_tasks.length) errors.ai_tasks = "Choose at least one option, or 'None of these'.";
    else if (a.ai_tasks.length > 1) a.ai_tasks = a.ai_tasks.filter(function (t) { return t !== "none"; });

    a.disliked_task = str(raw.disliked_task).slice(0, 500);

    // Consistency check: total weekly workload per person must be plausible.
    if (!Object.keys(errors).length) {
      var perWeek = occurrencesPerWeek(a);
      var perPersonWeekly = perWeek * a.minutes_per_occurrence / 60;
      if (perPersonWeekly > L.maxWeeklyHoursPerPerson)
        errors.duration = "Those answers add up to more than " + L.maxWeeklyHoursPerPerson +
          " hours a week for each person. Check the frequency, time taken and number of people.";
    }

    return { ok: Object.keys(errors).length === 0, errors: errors, answers: a };
  }

  // ---------- calculation ----------
  function occurrencesPerWeek(a) {
    if (a.frequency === "several_daily") return a.occurrences_per_day * CONFIG.workingDaysPerWeek;
    return FREQUENCIES[a.frequency].perWeek;
  }

  function calculate(a) {
    var perWeek = occurrencesPerWeek(a);
    // Brief formula: occurrences/week × minutes × people ÷ 60. Each person performs each occurrence.
    var weeklyHours = perWeek * a.minutes_per_occurrence * a.people / 60;
    var annualHours = weeklyHours * CONFIG.weeksPerYear;
    var annualTimeValue = a.hourly_cost ? annualHours * a.hourly_cost : null;
    var recLow = annualHours * CONFIG.scenarioLow;
    var recHigh = annualHours * CONFIG.scenarioHigh;

    var freqNote = a.frequency === "several_daily"
      ? (a.occurrences_per_day + " times a day × " + CONFIG.workingDaysPerWeek + " working days = " + fmt(perWeek, 0) + " per week" +
         (a.occurrences_per_day_defaulted ? " (you didn't give a number, so the default of " + CONFIG.defaultOccurrencesPerDay + " a day was used)" : ""))
      : (FREQUENCIES[a.frequency].label + " = " + FREQUENCIES[a.frequency].perWeek + " per week (" + FREQUENCIES[a.frequency].note + ")");

    var assumptions = [
      "Frequency: " + freqNote + ".",
      "Time per occurrence: " + fmt(a.minutes_per_occurrence, 0) + " minutes, done by " + a.people + (a.people === 1 ? " person" : " people") + " each time.",
      "Working weeks per year: " + CONFIG.weeksPerYear + " (allows for holidays).",
      a.hourly_cost
        ? "Hourly employment cost: " + money(a.hourly_cost) + " (your estimate). The time value is what that time costs, not a cash saving."
        : "No hourly cost entered, so no time value has been calculated.",
      "Recoverable hours use an illustrative " + (CONFIG.scenarioLow * 100) + "–" + (CONFIG.scenarioHigh * 100) +
        "% scenario to show what's possible. It is not a prediction. Real results depend on a review of the process."
    ];

    return {
      assumptions_version: CONFIG.version,
      occurrences_per_week: round(perWeek, 2),
      weekly_hours: round(weeklyHours, 1),
      annual_hours: round(annualHours, 0),
      hourly_cost: a.hourly_cost,
      annual_time_value: annualTimeValue === null ? null : round(annualTimeValue, 0),
      recoverable_hours_low: round(recLow, 0),
      recoverable_hours_high: round(recHigh, 0),
      recoverable_value_low: a.hourly_cost ? round(recLow * a.hourly_cost, 0) : null,
      recoverable_value_high: a.hourly_cost ? round(recHigh * a.hourly_cost, 0) : null,
      assumptions: assumptions
    };
  }

  // ---------- ranking ----------
  // Filter by process match first, then weigh priority, symptom type, manual effort and feasibility.
  // Never ranked purely by theoretical saving. Every pick is marked "Explore".
  function recommend(a, results) {
    var scored = LIBRARY.map(function (rule, idx) {
      var s = 0;
      var primary = rule.processes.indexOf(a.primary_process) !== -1;
      var secondary = a.processes.some(function (p) { return p !== a.primary_process && rule.processes.indexOf(p) !== -1; });
      if (primary) s += 100; else if (secondary) s += 50;
      if (rule.priorities.indexOf(a.priority) !== -1) s += 20;
      if (rule.problem_types.indexOf(a.problem_type) !== -1) s += 8;
      if (primary && a.manual_level === "manual") s += 6;
      if (primary && results) s += Math.min(results.annual_hours / 50, 10);           // workload, capped
      if (a.error_frequency === "frequently" && rule.problem_types.indexOf("dropped") !== -1) s += 4;
      if (a.tools_count === "6+" && rule.id === "crm_sync") s += 6;                  // many tools → re-keying likely
      if (a.tools_count === "6+" && rule.complexity === "Medium") s -= 2;            // feasibility
      if (rule.revenue_linked) s += 3;                                                // tie-break toward revenue impact
      return { rule: rule, score: s, matched: primary || secondary, idx: idx };
    });
    scored.sort(function (x, y) { return y.score - x.score || x.idx - y.idx; });
    var matched = scored.filter(function (x) { return x.matched; });
    var rest = scored.filter(function (x) { return !x.matched; });
    return matched.concat(rest).slice(0, 3).map(function (x) {
      return Object.assign({ status: "Explore", match: x.matched ? "process" : "priority" }, x.rule);
    });
  }

  // AI ranking: the tasks they said eat time come first, then fit with their processes and priority.
  function recommendAI(a) {
    var scored = AI_LIBRARY.map(function (rule, idx) {
      var s = 0;
      a.ai_tasks.forEach(function (t) { if (rule.ai_tasks.indexOf(t) !== -1) s += 100; });
      if (rule.processes.indexOf(a.primary_process) !== -1) s += 30;
      else if (a.processes.some(function (p) { return rule.processes.indexOf(p) !== -1; })) s += 15;
      if (rule.priorities.indexOf(a.priority) !== -1) s += 10;
      return { rule: rule, score: s, idx: idx };
    });
    scored.sort(function (x, y) { return y.score - x.score || x.idx - y.idx; });
    return scored.slice(0, 3).map(function (x) {
      return Object.assign({ status: "Explore", match: x.score >= 100 ? "task" : "process" }, x.rule);
    });
  }

  function firstStep(a, recs) {
    var top = recs[0];
    return {
      title: "Start with: " + top.title,
      action: top.next_step,
      validate: "To check this would work, we'd confirm: what triggers the process, which tools hold the data (and whether they can be connected), how exceptions are handled today, and who owns the result."
    };
  }

  // ---------- full pipeline ----------
  function run(raw) {
    var v = validate(raw);
    if (!v.ok) return { ok: false, errors: v.errors, answers: v.answers };
    var results = calculate(v.answers);
    var recs = recommend(v.answers, results);
    return {
      ok: true,
      answers: v.answers,
      results: results,
      recommendations: recs,
      ai_recommendations: recommendAI(v.answers),
      first_step: firstStep(v.answers, recs),
      narrative: PROBLEM_NARRATIVE[v.answers.problem_type] || ""
    };
  }

  // ---------- report rendering (email-safe HTML: tables + inline styles) ----------
  function renderReportHtml(out, contact, opts) {
    opts = opts || {};
    contact = contact || {};
    var a = out.answers, r = out.results;
    var C = { ink: "#111211", muted: "#5F5F59", line: "#DEDCD3", soft: "#F1F0EA", accent: "#0F6E56", warn: "#8a5a00", warnBg: "#fff4dc" };
    var font = "font-family:Inter,Arial,Helvetica,sans-serif;";
    function h2(t) { return '<h2 style="' + font + 'font-size:18px;color:' + C.ink + ';margin:28px 0 10px;">' + t + "</h2>"; }
    function p(t, extra) { return '<p style="' + font + 'font-size:14px;line-height:1.55;color:' + C.ink + ';margin:0 0 10px;' + (extra || "") + '">' + t + "</p>"; }
    function row(k, v) {
      return '<tr><td style="' + font + 'font-size:13px;color:' + C.muted + ';padding:7px 10px;border-bottom:1px solid ' + C.line + ';width:42%;">' + k +
        '</td><td style="' + font + 'font-size:14px;color:' + C.ink + ';padding:7px 10px;border-bottom:1px solid ' + C.line + ';">' + v + "</td></tr>";
    }
    function table(rows) { return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + rows + "</table>"; }

    var greet = contact.name ? "Hi " + escapeHtml(contact.name) + "," : "Hi,";
    var procList = a.processes.map(function (k) { return labelOf("processes", k); }).join(", ");

    var html = "";
    html += '<div style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px;">';
    html += '<p style="' + font + 'font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + C.accent + ';margin:0 0 6px;font-weight:bold;">Automation &amp; AI Opportunity Report</p>';
    html += '<h1 style="' + font + 'font-size:24px;color:' + C.ink + ';margin:0 0 14px;">' +
      (contact.company ? escapeHtml(contact.company) + ": " : "") + labelOf("processes", a.primary_process) + "</h1>";
    if (opts.email) html += p(greet) + p("Here is your personalised report from the Automation &amp; AI Opportunity Calculator. Every figure below is an estimate based on your answers.");

    html += h2("1. Business snapshot");
    html += table(
      row("Business type", labelOf("business_type", a.business_type)) +
      row("Team size", labelOf("team_size", a.team_size)) +
      row("Process estimated", labelOf("processes", a.primary_process)) +
      row("Other processes selected", procList) +
      row("Software tools involved", labelOf("tools_count", a.tools_count)) +
      row("How automated today", labelOf("manual_level", a.manual_level)) +
      row("Main priority", labelOf("priority", a.priority))
    );

    html += h2("2. Workload estimate");
    html += table(
      row("Estimated weekly workload", "<strong>" + fmt(r.weekly_hours) + " hours</strong>") +
      row("Estimated annual workload", "<strong>" + fmt(r.annual_hours, 0) + " hours</strong>") +
      (r.annual_time_value !== null ? row("Estimated labour-time value (per year)", "<strong>" + money(r.annual_time_value) + "</strong>") : "") +
      row("Illustrative recoverable time (" + CONFIG.scenarioLow * 100 + "–" + CONFIG.scenarioHigh * 100 + "% scenario)",
        fmt(r.recoverable_hours_low, 0) + "–" + fmt(r.recoverable_hours_high, 0) + " hours a year" +
        (r.recoverable_value_low !== null ? " (" + money(r.recoverable_value_low) + "–" + money(r.recoverable_value_high) + " of time value)" : ""))
    );
    html += '<div style="background:' + C.soft + ';padding:12px 14px;margin-top:12px;border-radius:6px;">' +
      p("<strong>Assumptions used</strong>", "margin-bottom:6px;") +
      '<ul style="' + font + 'font-size:13px;line-height:1.5;color:' + C.muted + ';margin:0;padding-left:18px;">' +
      r.assumptions.map(function (s) { return "<li>" + escapeHtml(s) + "</li>"; }).join("") + "</ul></div>";
    if (out.narrative) html += p(escapeHtml(out.narrative), "margin-top:12px;");

    function caseStudy(key) {
      var cs = key && CASE_STUDIES[key];
      if (!cs) return "";
      return '<div style="border-left:3px solid ' + C.accent + ';padding:8px 12px;margin-top:12px;background:' + C.soft + ';">' +
        p("<strong>Real example: " + escapeHtml(cs.title) + "</strong>", "margin-bottom:4px;") +
        p(escapeHtml(cs.summary), "font-size:13px;color:" + C.muted + ";") +
        p("<em>“" + escapeHtml(cs.quote) + "”</em> — " + escapeHtml(cs.attribution), "font-size:13px;margin:0;") + "</div>";
    }
    function badge(t) { return ' <span style="font-size:11px;font-weight:bold;color:' + C.warn + ';background:' + C.warnBg + ';padding:2px 7px;border-radius:10px;vertical-align:middle;">' + t + "</span>"; }
    var shown = {};

    html += h2("3. Top three automation opportunities");
    out.recommendations.forEach(function (rec, i) {
      html += '<div style="border:1px solid ' + C.line + ';border-radius:8px;padding:14px 16px;margin:0 0 14px;">';
      html += '<p style="' + font + 'font-size:16px;font-weight:bold;color:' + C.ink + ';margin:0 0 4px;">' + (i + 1) + ". " + escapeHtml(rec.title) +
        badge("EXPLORE") + "</p>";
      html += table(
        row("AI or rules?", escapeHtml(rec.approach)) +
        row("The problem", escapeHtml(rec.symptoms)) +
        row("Possible flow", escapeHtml(rec.workflow)) +
        row("Example integrations", escapeHtml(rec.integrations)) +
        row("You'd need", escapeHtml(rec.prerequisites)) +
        row("Complexity", escapeHtml(rec.complexity)) +
        row("Likely benefits", escapeHtml(rec.benefits)) +
        row("Risks / caveats", escapeHtml(rec.risks)) +
        row("Where a person stays involved", escapeHtml(rec.human_review))
      );
      if (!shown[rec.case_study]) { html += caseStudy(rec.case_study); shown[rec.case_study] = true; }
      html += "</div>";
    });

    html += h2("4. Where AI could help");
    html += p("Automation follows fixed rules. AI is useful where a task needs reading, writing or judgement. Based on the tasks you said take up your team's time, these are the three AI uses worth exploring. In each one, a person stays in charge of decisions.", "color:" + C.muted + ";");
    (out.ai_recommendations || []).forEach(function (rec, i) {
      html += '<div style="border:1px solid ' + C.line + ';border-left:3px solid ' + C.accent + ';border-radius:8px;padding:14px 16px;margin:0 0 14px;">';
      html += '<p style="' + font + 'font-size:16px;font-weight:bold;color:' + C.ink + ';margin:0 0 4px;">' + (i + 1) + ". " + escapeHtml(rec.title) + badge("AI · EXPLORE") + "</p>";
      html += table(
        row("What the AI does", escapeHtml(rec.what_ai_does)) +
        row("What it looks like", escapeHtml(rec.example)) +
        row("Example tools", escapeHtml(rec.tools)) +
        row("You'd need", escapeHtml(rec.data_needed)) +
        row("Complexity", escapeHtml(rec.complexity)) +
        row("Where a person stays in charge", escapeHtml(rec.human_role)) +
        row("Risks / caveats", escapeHtml(rec.risks)) +
        row("A first step", escapeHtml(rec.first_step))
      );
      if (!shown[rec.case_study]) { html += caseStudy(rec.case_study); shown[rec.case_study] = true; }
      html += "</div>";
    });

    html += h2("5. What to do first");
    html += p("<strong>" + escapeHtml(out.first_step.title) + "</strong>");
    html += p(escapeHtml(out.first_step.action));
    html += p(escapeHtml(out.first_step.validate), "color:" + C.muted + ";font-size:13px;");

    html += h2("6. Next step (optional)");
    html += p("If you'd like a second pair of eyes, you can request a free 15-minute review of this one workflow. We'll walk through how it runs today and whether automation or AI is worth it. There's no obligation and no pitch deck.");
    if (opts.reviewUrl) html += '<p style="margin:14px 0;"><a href="' + escapeHtml(opts.reviewUrl) + '" style="' + font + 'display:inline-block;background:' + C.accent + ';color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:bold;font-size:14px;">Request a free 15-minute workflow review</a></p>';

    html += '<p style="' + font + 'font-size:12px;line-height:1.5;color:' + C.muted + ';margin:28px 0 0;border-top:1px solid ' + C.line + ';padding-top:12px;">' +
      "These results are estimates based on your answers. They are not guaranteed savings. Any proposed automation or AI use needs to be checked against your existing processes, tools and requirements. " +
      "Report ref: " + escapeHtml(opts.submissionId || "") + " · assumptions v" + CONFIG.version + "</p>";
    html += "</div>";
    return html;
  }

  function renderReportText(out) {
    var a = out.answers, r = out.results;
    var lines = [
      "AUTOMATION & AI OPPORTUNITY REPORT: " + labelOf("processes", a.primary_process),
      "",
      "Weekly workload (estimate): " + fmt(r.weekly_hours) + " hours",
      "Annual workload (estimate): " + fmt(r.annual_hours, 0) + " hours",
      r.annual_time_value !== null ? "Estimated labour-time value: " + money(r.annual_time_value) + " a year" : "",
      "Illustrative recoverable time: " + fmt(r.recoverable_hours_low, 0) + "–" + fmt(r.recoverable_hours_high, 0) + " hours a year",
      "",
      "Assumptions:"
    ].concat(r.assumptions.map(function (s) { return "- " + s; }), ["", "Top opportunities (to explore):"],
      out.recommendations.map(function (x, i) { return (i + 1) + ". " + x.title + " [" + x.approach + "]: " + x.workflow; }),
      ["", "Where AI could help (to explore):"],
      (out.ai_recommendations || []).map(function (x, i) { return (i + 1) + ". " + x.title + ": " + x.what_ai_does; }),
      ["", "What to do first: " + out.first_step.action, "",
       "These are estimates based on your answers, not guaranteed savings."]);
    return lines.filter(function (l, i, arr) { return l !== "" || arr[i - 1] !== ""; }).join("\n");
  }

  return {
    CONFIG: CONFIG, FREQUENCIES: FREQUENCIES, OPTIONS: OPTIONS, LIBRARY: LIBRARY, AI_LIBRARY: AI_LIBRARY, CASE_STUDIES: CASE_STUDIES,
    validate: validate, calculate: calculate, recommend: recommend, recommendAI: recommendAI, run: run,
    renderReportHtml: renderReportHtml, renderReportText: renderReportText,
    labelOf: labelOf, fmt: fmt, money: money, escapeHtml: escapeHtml
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = AutomationCalc;
