const taxonomy = require('./taxonomy');

// Deterministic recommendations per taxonomy topic key (16 topics)
// Each entry has: team, action (1 to 2 concrete, topic-specific sentences)
const recommendations = {
  customer_service_response_time: {
    team: 'Customer Support',
    action: 'Establish priority queueing for unresolved escalation tickets and add peak-hour triage coverage to reduce first-response delays.',
  },
  customer_service_resolution_quality: {
    team: 'Customer Support',
    action: 'Conduct peer review of repeated support handoffs and update frontline escalation playbooks to ensure first-contact resolution.',
  },
  customer_service_staff_behavior: {
    team: 'Customer Support',
    action: 'Coach frontline representatives on empathetic communication and de-escalation protocols for frustrated customers.',
  },
  product_quality: {
    team: 'Product',
    action: 'Inspect manufacturing batch defects with QA suppliers and introduce pre-shipment quality verification gates.',
  },
  product_value: {
    team: 'Product',
    action: 'Review competitive tier pricing and transparently communicate product inclusions and bundled warranty benefits.',
  },
  product_feature_functionality: {
    team: 'Product',
    action: 'Prioritize bug fixes for broken feature workflows and refine UI interaction affordances based on customer struggle points.',
  },
  product_reliability_durability: {
    team: 'Product',
    action: 'Run accelerated stress testing on high-failure components and offer proactive warranty replacements for known wear issues.',
  },
  product_setup_usage: {
    team: 'Product',
    action: 'Revise quick-start setup documentation, add visual step-by-step guides, and streamline initial device configuration.',
  },
  fraud_seller_scamming: {
    team: 'Trust & Safety',
    action: 'Audit suspicious seller listings, enforce mandatory merchant identity verification, and freeze payouts on flagged scam storefronts.',
  },
  fraud_payment_pressure: {
    team: 'Trust & Safety',
    action: 'Block off-platform payment solicitations, warn buyers against external transfers, and suspend sellers demanding surcharge fees.',
  },
  fraud_counterfeit_or_misrepresentation: {
    team: 'Trust & Safety',
    action: 'Deploy automated image and brand trademark screening, verify authorized distributor certificates, and delist counterfeit merchandise.',
  },
  delivery_delay: {
    team: 'Logistics',
    action: 'Renegotiate SLA adherence with regional carrier partners and establish dynamic courier rerouting during transit bottlenecks.',
  },
  delivery_damage_or_condition: {
    team: 'Logistics',
    action: 'Upgrade transit protective packaging standards and hold fulfilment centers accountable for fragile handling compliance.',
  },
  delivery_tracking_and_updates: {
    team: 'Logistics',
    action: 'Integrate real-time carrier webhook notifications and dispatch automated SMS/email status milestones to customers.',
  },
  shipping_packaging_and_handling: {
    team: 'Logistics',
    action: 'Standardize box sizing, optimize shock-absorbing void fill, and inspect warehouse carton sealing protocols.',
  },
  order_processing_and_expectations: {
    team: 'Web Engineering',
    action: 'Fix checkout edge-case errors, resolve inventory sync mismatches, and present accurate estimated delivery windows before purchase.',
  },
};

// Validate that every taxonomy key has a recommendation
for (const item of taxonomy) {
  if (!recommendations[item.key]) {
    recommendations[item.key] = {
      team: 'Operations',
      action: `Review customer complaints regarding ${item.label.toLowerCase()} and assign corrective measures.`,
    };
  }
}

module.exports = recommendations;
