// utils/roles.js
export const ROLES = { ADMIN: 'admin', MANAGER: 'manager', EMPLOYEE: 'employee' };

export const normalizeRole = (r) => String(r || '').trim().toLowerCase();

export const ASSIGN_PERMISSIONS = {
  admin:   ['manager', 'employee'],
  manager: ['employee'],
  employee: [],
};

// Always compare normalized values
export const canAssign = (actorRole, assigneeRole) => {
  console.log(`canAssign: ${actorRole} -> ${assigneeRole}`);
  const a = normalizeRole(actorRole);
  const b = normalizeRole(assigneeRole);
  console.log(ASSIGN_PERMISSIONS[a]?.includes(b));
  return ASSIGN_PERMISSIONS[a]?.includes(b);
};

// Optional: make role names pretty for messages
export const prettyRole = (r) => {
  const x = normalizeRole(r);
  return x ? x[0].toUpperCase() + x.slice(1) : x;
};


export const STATUSES = ["Todo", "InProgress", "Completed", "Closed"];
export const PRIORITIES = ["Low", "Medium", "High"];