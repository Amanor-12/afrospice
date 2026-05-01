import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaBriefcase as FiBriefcase,
  FaChartLine as FiActivity,
  FaMagnifyingGlass as FiSearch,
  FaPlus as FiPlus,
  FaShieldHalved as FiShield,
  FaUser as FiUser,
  FaUserShield as FiUserCheck,
  FaUsers as FiUsers,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import SoftPagination from "./shared/SoftPagination";
import { getIdentityInitials } from "./shared/identityAvatar";
import { formatDate, getResponseData, toArray, toNumber } from "./shared/dataHelpers";
import WorkspaceBannerStack from "./shared/WorkspaceBannerStack";
import WorkspaceDataStatus from "./shared/WorkspaceDataStatus";

const DIRECTORY_PAGE_SIZE = 8;

function getStatusTone(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("inactive") || normalized.includes("suspend")) return "danger";
  if (normalized.includes("pending")) return "warning";
  if (normalized.includes("active")) return "success";
  return "neutral";
}

function Users({ currentUser }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("directory");
  const [roleFilter, setRoleFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [directoryPage, setDirectoryPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());

  const isOwner = String(currentUser?.role || "") === "Owner";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const load = async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }
        const response = await API.get("/users");
        if (cancelled) return;

        startTransition(() => {
          const nextUsers = toArray(getResponseData(response));
          setUsers(nextUsers);
          setLastUpdated(String(nextUsers[0]?.updatedAt || new Date().toISOString()));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || "Could not load users.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
      load({ silent: true });
    }, LIVE_PAGE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setDirectoryPage(1);
  }, [query, roleFilter, departmentFilter, statusFilter, users.length]);

  useEffect(() => {
    const focus = String(location.state?.assistantFocus || "").trim();
    if (focus !== "users-directory") return;

    setActiveTab("directory");
    window.requestAnimationFrame(() => {
      document.getElementById("users-directory-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.key, location.state]);

  const filteredUsers = useMemo(() => {
    const term = String(query || "").trim().toLowerCase();

    return users.filter((user) => {
      if (roleFilter !== "All" && String(user?.role || "") !== roleFilter) return false;
      if (departmentFilter !== "All" && String(user?.department || "") !== departmentFilter) return false;
      if (statusFilter !== "All" && String(user?.status || "") !== statusFilter) return false;
      if (!term) return true;

      return [user?.fullName, user?.staffId, user?.email, user?.department].some((field) =>
        String(field || "")
          .toLowerCase()
          .includes(term)
      );
    });
  }, [users, query, roleFilter, departmentFilter, statusFilter]);

  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          users
            .map((user) => String(user?.department || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [users]
  );

  const roleCounts = useMemo(() => {
    const counts = {
      owners: 0,
      managers: 0,
      cashiers: 0,
      inventory: 0,
    };

    users.forEach((user) => {
      const role = String(user?.role || "");
      if (role === "Owner") counts.owners += 1;
      if (role === "Manager") counts.managers += 1;
      if (role === "Cashier") counts.cashiers += 1;
      if (role === "Inventory Clerk") counts.inventory += 1;
    });

    return counts;
  }, [users]);

  const activeCount = users.filter((user) => String(user?.status || "") === "Active").length;
  const pendingCount = users.filter((user) => String(user?.status || "") === "Pending Approval").length;
  const sessionCount = users.reduce((sum, user) => sum + toNumber(user?.oversight?.activeSessionCount), 0);
  const failedLogins = users.reduce((sum, user) => sum + toNumber(user?.oversight?.failedLoginCount7d), 0);

  const sessionWatch = useMemo(
    () =>
      users
        .filter(
          (user) =>
            toNumber(user?.oversight?.activeSessionCount) > 0 ||
            toNumber(user?.oversight?.failedLoginCount7d) > 0
        )
        .sort(
          (left, right) =>
            toNumber(right?.oversight?.failedLoginCount7d) - toNumber(left?.oversight?.failedLoginCount7d) ||
            toNumber(right?.oversight?.activeSessionCount) - toNumber(left?.oversight?.activeSessionCount)
        )
        .slice(0, 6),
    [users]
  );

  const accessPostureRows = [
    {
      label: "Owner account",
      value: roleCounts.owners ? `${roleCounts.owners} configured` : "Missing",
      tone: roleCounts.owners ? "success" : "danger",
      note: roleCounts.owners ? "Owner access is the only enabled app operator path." : "Create or restore the owner account before go-live.",
      action: "Review Owner",
      onClick: () => {
        setRoleFilter("Owner");
        setDepartmentFilter("All");
        setStatusFilter("All");
      },
    },
    {
      label: "Pending approvals",
      value: `${pendingCount}`,
      tone: pendingCount ? "warning" : "success",
      note: pendingCount ? "Records need owner review before staff can be activated." : "No staff records are waiting on owner approval.",
      action: "Open Pending",
      onClick: () => {
        setRoleFilter("All");
        setDepartmentFilter("All");
        setStatusFilter("Pending Approval");
      },
    },
    {
      label: "Session risk",
      value: `${sessionCount} live / ${failedLogins} failed`,
      tone: failedLogins ? "warning" : "success",
      note: failedLogins ? "Failed sign-ins need review before approving more access." : "No failed sign-in pressure is active in the 7-day window.",
      action: "Open Watch",
      onClick: () => document.getElementById("users-session-board")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      label: "Staff records",
      value: `${users.length}`,
      tone: users.length ? "neutral" : "warning",
      note: "Staff records are retained for audit, scheduling, and accountability. App operation stays owner-only.",
      action: "Open Directory",
      onClick: () => document.getElementById("users-directory-board")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
  ];

  const summaryCards = [
    { label: "Staff Records", value: `${users.length}`, note: `${activeCount} active records`, icon: FiUsers },
    { label: "Owner Control", value: `${roleCounts.owners}`, note: "Only owner can operate the app", icon: FiShield },
    { label: "Inventory Records", value: `${roleCounts.inventory}`, note: "For stock accountability only", icon: FiUser },
    { label: "Approval Queue", value: `${pendingCount}`, note: "Owner review required", icon: FiUser },
  ];

  const openStaffCreate = (sourceLabel = "Create Staff Record") => {
    navigate("/users/staff/new", {
      state: {
        assistantActionLabel: "New staff record",
        assistantActionNote: `${sourceLabel} opened the staff setup workflow.`,
      },
    });
  };

  const openStaffRecord = (user) => {
    if (!user?.id) return;

    navigate(`/users/staff/${user.id}`, {
      state: {
        assistantActionLabel: user?.fullName ? `${user.fullName} record opened` : "Staff record opened",
        assistantActionNote: "Review access, role coverage, schedule, and activation controls here.",
        detailTab: "users-security-board",
      },
    });
  };

  const quickTools = [
    {
      key: "invite",
      label: "Invite Workspace User",
      note: "Create the next staff record with role and approval defaults.",
      icon: FiPlus,
      actionLabel: "Create Staff Record",
      onClick: () => openStaffCreate("Workforce tools"),
    },
    {
      key: "pending",
      label: "Approval Queue",
      note: `${pendingCount} staff records are waiting for activation review.`,
      icon: FiUserCheck,
      actionLabel: "Review Pending",
      onClick: () => {
        setStatusFilter("Pending Approval");
        document.getElementById("users-directory-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      key: "sessions",
      label: "Session Watch",
      note: `${sessionCount} live sessions / ${failedLogins} failed sign-ins need visibility.`,
      icon: FiActivity,
      actionLabel: "Open Watch",
      onClick: () => {
        document.getElementById("users-session-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      key: "roles",
      label: "Owner Access Controls",
      note: `${roleCounts.owners} owner account controls the live workspace; staff remain records for audit.`,
      icon: FiBriefcase,
      actionLabel: "Review Access",
      onClick: () => {
        document.getElementById("users-roles-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
  ];

  const resetFilters = () => {
    setQuery("");
    setRoleFilter("All");
    setDepartmentFilter("All");
    setStatusFilter("All");
  };

  const commandFilters = [
    {
      key: "all",
      label: "All staff",
      active: roleFilter === "All" && departmentFilter === "All" && statusFilter === "All",
      onClick: resetFilters,
    },
    {
      key: "pending",
      label: `Pending (${pendingCount})`,
      active: statusFilter === "Pending Approval",
      onClick: () => {
        setRoleFilter("All");
        setDepartmentFilter("All");
        setStatusFilter("Pending Approval");
      },
    },
    {
      key: "cashier",
      label: `Cashiers (${roleCounts.cashiers})`,
      active: roleFilter === "Cashier",
      onClick: () => {
        setRoleFilter("Cashier");
        setDepartmentFilter("All");
        setStatusFilter("All");
      },
    },
    {
      key: "inventory",
      label: `Inventory (${roleCounts.inventory})`,
      active: roleFilter === "Inventory Clerk",
      onClick: () => {
        setRoleFilter("Inventory Clerk");
        setDepartmentFilter("All");
        setStatusFilter("All");
      },
    },
  ];
  const usersRouteStatus = loading
    ? "Syncing workforce..."
    : lastUpdated
    ? `Updated ${formatDate(lastUpdated)}`
    : "Workforce routes ready";
  const usersQuickRoutes = [
    {
      key: "directory",
      label: "Open Directory",
      onClick: () => {
        setActiveTab("directory");
        document.getElementById("users-directory-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      primary: activeTab === "directory",
    },
    {
      key: "sessions",
      label: "Open Sessions",
      onClick: () => {
        setActiveTab("sessions");
        document.getElementById("users-session-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      primary: activeTab === "sessions",
    },
    {
      key: "invite",
      label: "Create Staff Record",
      onClick: () => openStaffCreate("User management routes"),
      primary: false,
    },
  ];

  const directoryTotalPages = Math.max(1, Math.ceil(filteredUsers.length / DIRECTORY_PAGE_SIZE));
  const activeDirectoryPage = Math.min(directoryPage, directoryTotalPages);
  const directoryRows = filteredUsers.slice(
    (activeDirectoryPage - 1) * DIRECTORY_PAGE_SIZE,
    activeDirectoryPage * DIRECTORY_PAGE_SIZE
  );

  const updateStatus = async (user, status) => {
    if (!user?.id || !isOwner || updatingUserId) return;
    if (String(user?.id) === String(currentUser?.id) && status !== "Active") return;

    try {
      setUpdatingUserId(String(user.id));
      setError("");
      setNotice("");
      const response = await API.patch(`/users/${user.id}/status`, { status });
      const updatedUser = getResponseData(response);
      if (updatedUser?.id) {
        setUsers((current) =>
          current.map((entry) => (String(entry?.id) === String(updatedUser.id) ? updatedUser : entry))
        );
        setLastUpdated(String(updatedUser.updatedAt || new Date().toISOString()));
      }
      setNotice(`${user.fullName} set to ${status}.`);
    } catch (requestError) {
      setError(requestError?.message || "Could not update user status.");
    } finally {
      setUpdatingUserId("");
    }
  };

  return (
    <div className="page-container users-ref-page users-management-overview-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      <WorkspaceBannerStack error={error} notice={notice} />

      <section className="reference-page-heading users-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Owner Workforce Control</span>
          <h1>Staff Records</h1>
          <p>Review owner-controlled staff records, approvals, access posture, and operational accountability from one calmer oversight surface.</p>
        </div>

        <div className="reference-page-heading-actions">
          <WorkspaceDataStatus
            loading={loading}
            live={!loading && Boolean(lastUpdated)}
            liveIndicatorLabel="Live workforce directory"
            timestamp={lastUpdated}
            nowTick={nowTick}
            useRelativeTime
            showPausedBadge
          />
          <button type="button" className="btn btn-primary" onClick={() => openStaffCreate("User management header")}>
            <FiPlus />
            Create Staff Record
          </button>
        </div>
      </section>

      <section className="soft-panel soft-panel--compact control-signal-board users-management-route-board" aria-label="User management routes">
        <div className="route-pill-strip users-route-strip">
          <span className="route-pill-status">{usersRouteStatus}</span>
          {usersQuickRoutes.map((route) => (
            <button
              key={route.key}
              type="button"
              className={`route-pill-button${route.primary ? " is-primary" : ""}`}
              onClick={route.onClick}
            >
              {route.label}
            </button>
          ))}
        </div>
      </section>

      <section className="soft-summary-grid soft-summary-grid--four users-management-stats">
        {summaryCards.map((card) => (
          <article key={card.label} className="soft-summary-card">
            <div className="soft-summary-icon">{card.icon ? <card.icon /> : null}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="users-management-command-row">
        <div className="reference-inline-search users-management-search">
          <FiSearch />
          <input
            className="input soft-table-search"
            type="text"
            placeholder="Search profiles, emails, or usernames"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="users-management-command-actions" aria-label="User directory quick filters">
          {commandFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`users-command-chip ${filter.active ? "is-active" : ""}`}
              onClick={filter.onClick}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      <section id="users-directory-board" className="soft-panel soft-table-card users-directory-card">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Staff directory</span>
            <h2>Staff roster</h2>
          </div>
        </header>

        <div className="soft-table-toolbar soft-table-toolbar--filters users-directory-toolbar">
          <span className="users-directory-count">{filteredUsers.length} items</span>
          <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="All">All roles</option>
            <option value="Owner">Owner</option>
            <option value="Manager">Manager</option>
            <option value="Cashier">Cashier</option>
            <option value="Inventory Clerk">Inventory Clerk</option>
          </select>
          <select className="input" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
            <option value="All">All departments</option>
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="All">All statuses</option>
            <option value="Active">Active</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Inactive">Inactive</option>
          </select>
          {(query || roleFilter !== "All" || departmentFilter !== "All" || statusFilter !== "All") ? (
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={resetFilters}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Last Active</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    Loading staff records...
                  </td>
                </tr>
              ) : directoryRows.length ? (
                directoryRows.map((user) => (
                  <tr key={user?.id}>
                    <td>
                      <div className="reference-name-cell">
                        <span
                          className="reference-avatar reference-avatar--user"
                          data-tone="blue"
                        >
                          {getIdentityInitials(user?.fullName, "US")}
                        </span>
                        <div>
                          <strong>{user?.fullName || "Unnamed user"}</strong>
                          <div>{user?.staffId || "No staff id"}</div>
                        </div>
                      </div>
                    </td>
                    <td>{user?.email || "n/a"}</td>
                    <td>
                      <div className="users-role-cell">
                        <strong>{user?.role || "Unknown"}</strong>
                        <small>{user?.staffId || "No staff id"}</small>
                      </div>
                    </td>
                    <td>{user?.department || "Unassigned"}</td>
                    <td>{formatDate(user?.oversight?.lastLoginAt)}</td>
                    <td>
                      <span className={`status-pill small ${getStatusTone(user?.status)}`}>{user?.status || "Unknown"}</span>
                    </td>
                    <td>
                      <div className="soft-table-actions users-table-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={() => openStaffRecord(user)}
                        >
                          View
                        </button>
                        {isOwner ? (
                          <select
                            className={`input soft-table-select users-status-select users-status-select--${getStatusTone(user?.status)}`}
                            data-status={String(user?.status || "Pending Approval").toLowerCase().replace(/\s+/g, "-")}
                            value={user?.status || "Pending Approval"}
                            onChange={(event) => updateStatus(user, event.target.value)}
                            disabled={updatingUserId === String(user?.id)}
                          >
                            <option value="Pending Approval">Pending Approval</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                          </select>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No staff records match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SoftPagination currentPage={activeDirectoryPage} totalPages={directoryTotalPages} onChange={setDirectoryPage} />
      </section>

      <section className="soft-section-grid soft-section-grid--two users-reference-lower">
        <article id="users-roles-board" className="soft-panel users-access-posture-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Owner access posture</span>
              <h2>What needs the owner's decision</h2>
            </div>
          </header>
          <div className="users-access-posture-list">
            {accessPostureRows.map((row) => (
              <article key={row.label} className={`users-access-posture-row users-access-posture-row--${row.tone}`}>
                <div>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                  <p>{row.note}</p>
                </div>
                <button type="button" className="btn btn-secondary btn-compact" onClick={row.onClick}>
                  {row.action}
                </button>
              </article>
            ))}
          </div>
        </article>

        <article id="users-session-board" className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Session watch</span>
              <h2>Who deserves review</h2>
            </div>
          </header>
          <div className="soft-list">
            {sessionWatch.length ? (
              sessionWatch.map((user, index) => (
                <article key={`${user?.id || "user"}-${index}`} className="soft-list-row">
                  <div className="reference-name-cell reference-name-cell--compact">
                    <span
                      className="reference-avatar reference-avatar--user"
                      data-tone="blue"
                    >
                      {getIdentityInitials(user?.fullName, "US")}
                    </span>
                    <div>
                      <strong>{user?.fullName || "Staff member"}</strong>
                      <small>
                        {user?.role || "Unknown role"} / {user?.department || "Unknown department"}
                      </small>
                    </div>
                  </div>
                  <div className="soft-inline-value">
                    <strong>{toNumber(user?.oversight?.activeSessionCount)} live</strong>
                    <small>{toNumber(user?.oversight?.failedLoginCount7d)} failed / 7d</small>
                  </div>
                </article>
              ))
            ) : (
              <p className="subtle">No session or login-hygiene watch items are active right now.</p>
            )}
          </div>
        </article>
      </section>

      <section id="users-tools-board" className="soft-panel soft-panel--compact users-tools-board">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Workforce tools</span>
            <h2>Actions related to users and access</h2>
          </div>
          <span className={`status-pill small ${failedLogins > 0 ? "warning" : "success"}`}>
            {failedLogins} recent failed sign-ins
          </span>
        </header>
        <div className="soft-card-grid soft-card-grid--four users-tool-grid">
          {quickTools.map((tool) => (
            <article key={tool.key} className="soft-panel soft-panel--compact users-tool-card">
              <div className="users-tool-icon">
                <tool.icon />
              </div>
              <div className="users-tool-copy">
                <strong>{tool.label}</strong>
                <small>{tool.note}</small>
              </div>
              <button type="button" className="btn btn-secondary btn-compact" onClick={tool.onClick}>
                {tool.actionLabel}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Users;
