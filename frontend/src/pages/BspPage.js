import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function BspPage({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [batchNumber, setBatchNumber] = useState("");
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [showDetailsPopup, setShowDetailsPopup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [success, setSuccess] = useState(() => {
    const state = location.state;
    if (state?.migoPostSuccess) {
      return state?.migoPostMessage || 'Posted successfully.';
    }
    return '';
  });

  const fieldLabels = {
    Charg: "Batch Number",
    Werks: "Plant Number",
    MATNR: "Material Number",
    MAKTX: "Material Description",
    QTY: "Quantity",
    LGORT: "Storage Location",
    MEINS: "Unit of Measure",
    SOBKZ: "Special Stock"
  };

  useEffect(() => {
    const prefill = location.state?.prefillBatches;
    if (!prefill) return;

    const list = Array.isArray(prefill) ? prefill : [prefill];
    const normalized = list
      .filter(Boolean)
      .map((b) => (b?.d ? b : { d: b }));

    setBatches(normalized);

    const nextState = { ...(location.state || {}) };
    delete nextState.prefillBatches;
    navigate('/bsp', { replace: true, state: Object.keys(nextState).length ? nextState : null });
  }, [location.state, navigate]);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    onLogout();
    setShowLogoutConfirm(false);
  };

  const cancelLogout = () => {
    setShowLogoutConfirm(false);
  };

  const fetchBatch = async () => {
    setError(null);
    const input = batchNumber.trim().toUpperCase();
    if (!input) return setError("Please enter a batch number.");
    if (batches.some(b => b.d?.Charg === input)) return setError("This batch is already added.");

    setLoading(true);
    try {
      // Create timeout controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      let json;
      try {
        // Use local network URL
        const url = `http://192.168.60.105:5000/api/BatchInfo/${input}`;
        const res = await fetch(url, {
          signal: controller.signal
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          const errorData = (() => {
            try {
              return errorText ? JSON.parse(errorText) : {};
            } catch {
              return {};
            }
          })();
          const error = new Error(errorData.error || `Failed to fetch batch information (${res.status})`);
          error.status = res.status;
          error.response = { status: res.status, data: errorData };
          throw error;
        }

        const bodyText = await res.text();
        try {
          json = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          const preview = bodyText?.slice(0, 140) || '';
          throw new Error(`Server did not return JSON. Response starts with: ${preview}`);
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          const timeoutError = new Error('Request timeout');
          timeoutError.status = 408;
          timeoutError.response = { status: 408 };
          throw timeoutError;
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }
      
      const d = json?.d || json; // Handle both old and new response formats
      if (!d?.Charg || Number(d.QTY) <= 0) throw new Error("Failed to fetch batch information");
      setBatches(prev => [...prev, { d: d }]);
      setBatchNumber("");
    } catch (err) {
      if (err.status === 408) {
        setError(err.message || "Request timeout - The server took too long to respond. Please try again.");
      } else if (err.status === 404) {
        setError(err.message || "Batch not found");
      } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setError("Network error - Unable to connect to the server. Please check your connection and try again.");
      } else {
        setError(err.message || "An error occurred while fetching batch information");
      }
    } finally {
      setLoading(false);
    }
  };

  const cleanBatch = (batch) => {
    const batchToSend = { ...(batch?.d || batch) };
    delete batchToSend.__metadata;
    delete batchToSend.__batchInfo;
    return batchToSend;
  };

  const deleteOne = (charg) => {
    setBatches(prev => prev.filter(b => b.d?.Charg !== charg));
    if (selectedBatch?.d?.Charg === charg) {
      setSelectedBatch(null);
    }
  };

  const handleBack = () => {
    navigate("/main");
  };

  const clearAll = () => {
    setBatches([]);
    setSelectedBatch(null);
    setShowDetailsPopup(false);
    setError(null);
  };

  const openDetails = (batch) => {
    setSelectedBatch(batch);
    setShowDetailsPopup(true);
  };

  const closeDetails = () => {
    setShowDetailsPopup(false);
  };

  const next = () => {
    if (batches.length === 0) return setError("Please add at least one batch.");
    const batchListToSend = batches.map(cleanBatch);
    navigate("/migo", { state: { batchData: batchListToSend } });
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="user-info">
          <div className="user-details">
            <span className="username">{user?.username || "s.ashraf"}</span>
            <span className="server-info">
              Server {user?.server || "DEV"} • Client {user?.client || "110"}
            </span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '2rem',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '400px',
            width: '90%'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#333' }}>Confirm Logout</h3>
            <p style={{ margin: '0 0 1.5rem 0', color: '#666' }}>
              Are you sure you want to logout?
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelLogout}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: '1px solid #ddd',
                  backgroundColor: 'white',
                  color: '#666',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                style={{
                  padding: '0.75rem 1.5rem',
                  border: 'none',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: "600px", margin: "20px auto", padding: "1rem" }}>
        <div style={{ background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>

          {success && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", background: "#dcfce7", color: "#166534", padding: "0.75rem", borderRadius: "8px", marginBottom: "0.75rem" }}>
              <div>{success}</div>
              <button
                onClick={() => {
                  setSuccess('');
                  navigate('/bsp', { replace: true, state: null });
                }}
                style={{ padding: "0.35rem 0.75rem", background: "transparent", color: "#166534", border: "1px solid rgba(22,101,52,0.35)", borderRadius: "8px", cursor: "pointer" }}
              >
                Dismiss
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && fetchBatch()}
              placeholder="Enter batch number"
              style={{ flex: 1, padding: "0.85rem", borderRadius: "8px", border: "1px solid #d1d5db" }}
            />
            <button onClick={fetchBatch} disabled={loading} style={{ padding: "0.85rem 1.5rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "8px" }}>
              {loading ? "Loading..." : "Fetch"}
            </button>
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <button
              onClick={clearAll}
              disabled={batches.length === 0 || loading}
              style={{ width: "100%", padding: "0.85rem", background: "#ef4444", color: "#fff", border: "none", borderRadius: "8px" }}
            >
              Clear All
            </button>
          </div>

          {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "0.75rem", borderRadius: "8px", marginTop: "0.5rem" }}>{error}</div>}

          {batches.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: "1rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Batch Number</th>
                    <th style={{ textAlign: "left", padding: "0.5rem" }}>Quantity</th>
                    <th style={{ textAlign: "right", padding: "0.5rem" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(batch => (
                    <tr
                      key={batch.d?.Charg}
                      onClick={() => openDetails(batch)}
                      style={{ cursor: "pointer", background: selectedBatch?.d?.Charg === batch.d?.Charg ? "#e0f2fe" : "white", borderBottom: "12px solid #f3f4f6" }}
                    >
                      <td>{batch.d?.Charg}</td>
                      <td>{batch.d?.QTY}</td>
                      <td style={{ padding: "0.5rem", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => deleteOne(batch.d?.Charg)}
                          style={{ padding: "0.35rem 0.75rem", background: "#ef4444", color: "#fff", border: "none", borderRadius: "8px" }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "20px", left: "20px" }}>
        <button
          onClick={handleBack}
          disabled={loading}
          style={{ padding: "0.85rem 2rem", background: "#6b7280", color: "#fff", border: "none", borderRadius: "8px" }}
        >
          Back
        </button>
      </div>

      <div style={{ position: "fixed", bottom: "20px", right: "20px" }}>
        <button
          onClick={next}
          disabled={batches.length === 0 || loading}
          style={{ padding: "0.85rem 2rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "8px" }}
        >
          Next
        </button>
      </div>

      {showDetailsPopup && selectedBatch && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}
          onClick={closeDetails}
        >
          <div
            style={{ width: "100%", maxWidth: "620px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Batch Details</h3>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {Object.entries(cleanBatch(selectedBatch)).map(([key, value]) => (
                    <tr key={key} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "0.75rem", width: "45%", color: "#374151", fontWeight: 600, background: "#f9fafb" }}>
                        {fieldLabels[key] || key}
                      </td>
                      <td style={{ padding: "0.75rem", color: "#111827" }}>{String(value ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button
                onClick={closeDetails}
                style={{ padding: "0.85rem 2rem", background: "#6b7280", color: "#fff", border: "none", borderRadius: "8px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BspPage;
