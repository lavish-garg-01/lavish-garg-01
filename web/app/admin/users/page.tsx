import { AdminPanel, AdminShell } from "../../components/admin-shell";

const users = [
  ["Arjun Sharma", "arjun.s@example.com", "Free", "Active", "12", "3", "₹0.00"],
  ["Meera Nair", "meera.n@example.com", "Pro", "Active", "34", "9", "₹42.18"],
  ["Vikram Rao", "vikram.r@example.com", "Free", "Onboarding", "0", "0", "₹0.00"],
  ["Sneha Iyer", "sneha.i@example.com", "Pro", "Attention", "21", "6", "₹31.02"],
  ["Rohit Patil", "rohit.p@example.com", "Free", "Active", "8", "1", "₹0.00"],
  ["Kavya Singh", "kavya.s@example.com", "Pro", "Active", "48", "14", "₹58.91"],
];

export default function AdminUsers() {
  return <AdminShell active="/admin/users" title="Users" subtitle="Lifecycle, product usage and support context." actions={<button className="admin-button">Export users</button>}>
    <div className="admin-metrics compact"><article><p>Total users</p><strong>8,412</strong><small>+164 this week</small></article><article><p>7-day active</p><strong>1,284</strong><small>15.3% of total</small></article><article><p>Pro users</p><strong>482</strong><small>5.7% of total</small></article><article className="critical-metric"><p>Free AI violations</p><strong>0</strong><span className="invariant">PASS</span><small>All-time</small></article></div>
    <AdminPanel><div className="admin-toolbar"><label className="admin-search">⌕ <input placeholder="Search name, email or user ID" /></label><select><option>All plans</option><option>Free</option><option>Pro</option></select><select><option>All states</option><option>Active</option><option>Onboarding</option><option>Attention</option></select><button>More filters</button></div><div className="admin-data-table users-table"><div className="admin-data-row table-head"><span>User</span><span>Plan</span><span>State</span><span>Matches · 7d</span><span>Applications</span><span>AI spend · MTD</span><span /></div>{users.map((user) => <div className="admin-data-row" key={user[1]}><span><span className="small-avatar">{user[0].split(' ').map(x => x[0]).join('')}</span><span><strong>{user[0]}</strong><small>{user[1]}</small></span></span><span><b className={`plan-tag ${user[2].toLowerCase()}`}>{user[2]}</b></span><span>{user[3]}</span><span>{user[4]}</span><span>{user[5]}</span><span className={user[2] === 'Free' ? 'zero-cost' : ''}>{user[6]}</span><span><button>•••</button></span></div>)}</div><div className="table-pagination"><span>Showing 1–6 of 8,412</span><div><button disabled>←</button><button>1</button><button>2</button><button>→</button></div></div></AdminPanel>
  </AdminShell>;
}
