// frontend/src/pages/migoPage.js
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';

function MigoPage({ user, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const batchData = location.state?.batchData;

  const [formData, setFormData] = useState({
    salesOrder: '',
    salesOrderItem: '',
    salesOrderTo: '',
    salesOrderItemTo: '',
    movementType: '413',
    storageLocationTo: '',
    specialStock: 'E'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [validationPassed, setValidationPassed] = useState(false);
  const [transferResult, setTransferResult] = useState(null);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showPostSuccessPopup, setShowPostSuccessPopup] = useState(false);
  const [postSuccessData, setPostSuccessData] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (!batchData) {
      navigate('/bsp');
      return;
    }

    // Auto-populate sales order and item from batch data
    if (Array.isArray(batchData) && batchData.length > 0) {
      const firstBatch = batchData[0];
      const batchContent = firstBatch.d || firstBatch; // Handle both structures
      setFormData(prev => ({
        ...prev,
        salesOrder: batchContent.SalesOrder || '',
        salesOrderItem: batchContent.SoItem || ''
      }));
    } else if (batchData?.SalesOrder || batchData?.SoItem || batchData?.d?.SalesOrder || batchData?.d?.SoItem) {
      const batchContent = batchData.d || batchData;
      setFormData(prev => ({
        ...prev,
        salesOrder: batchContent.SalesOrder || '',
        salesOrderItem: batchContent.SoItem || ''
      }));
    }
  }, [batchData, navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const getAuthHeader = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  const preparePayload = () => {
    const nowIso = new Date().toISOString();

    // Use "to" fields if entered, otherwise use "from" fields
    const finalSalesOrderTo = formData.salesOrderTo || formData.salesOrder;
    const finalSalesOrderItemTo = formData.salesOrderItemTo || formData.salesOrderItem;

    if (Array.isArray(batchData)) {
      const first = batchData[0] || {};
      const firstContent = first.d || first;
      return {
        ...formData,
        ...firstContent,
        salesOrderTo: finalSalesOrderTo,
        salesOrderItemTo: finalSalesOrderItemTo,
        docDate: nowIso,
        postingDate: nowIso,
        items: batchData,
        // Map to expected backend field names
        salesOrder: firstContent.SalesOrder || formData.salesOrder,
        salesOrderItem: firstContent.SoItem || formData.salesOrderItem,
        movementType: formData.movementType,
        storageLocationTo: formData.storageLocationTo,
        specialStock: formData.specialStock,
        MATNR: firstContent.MATNR,
        Werks: firstContent.Werks,
        LGORT: firstContent.LGORT,
        MEINS: firstContent.MEINS,
        Charg: firstContent.Charg,
        QTY: firstContent.QTY,
        SOBKZ: firstContent.SOBKZ
      };
    }

    const batchContent = batchData.d || batchData;
    return {
      ...formData,
      ...batchContent,
      salesOrderTo: finalSalesOrderTo,
      salesOrderItemTo: finalSalesOrderItemTo,
      docDate: nowIso,
      postingDate: nowIso,
      // Map to expected backend field names
      salesOrder: batchContent.SalesOrder || formData.salesOrder,
      salesOrderItem: batchContent.SoItem || formData.salesOrderItem,
      movementType: formData.movementType,
      storageLocationTo: formData.storageLocationTo,
      specialStock: formData.specialStock,
      MATNR: batchContent.MATNR,
      Werks: batchContent.Werks,
      LGORT: batchContent.LGORT,
      MEINS: batchContent.MEINS,
      Charg: batchContent.Charg,
      QTY: batchContent.QTY,
      SOBKZ: batchContent.SOBKZ
    };
  };

  const handleCheck = async () => {
    await handleTransfer(true);
  };

  const handlePost = async () => {
    await handleTransfer(false);
  };

  const handleFetchAgain = () => {
    navigate('/bsp', { replace: true, state: null });
  };

  const handleTransfer = async (isTestRun) => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const payload = preparePayload();
      
      if (isTestRun) {
        // Use gateway endpoints for test run
        const csrfResponse = await axios.get('https://sap-app-maoe.onrender.com/api/migo/gateway/csrf', {
          headers: getAuthHeader()
        });
        
        if (!csrfResponse.data.success) {
          throw new Error('Failed to get CSRF token');
        }
        
        const response = await axios.post('https://sap-app-maoe.onrender.com/api/migo/gateway/post', {
          csrfToken: csrfResponse.data.csrfToken,
          cookies: csrfResponse.data.cookies,
          transferData: payload
        }, {
          headers: getAuthHeader()
        });
        
        if (response.data.success) {
          setTransferResult(response.data.data);
          setValidationPassed(true);
          setSuccessMessage('Validation successful!');
          setShowSuccessPopup(true);
        } else {
          throw new Error(response.data.error || 'Validation failed');
        }
      } else {
        // Use gateway endpoint for actual post
        const csrfResponse = await axios.get('https://sap-app-maoe.onrender.com/api/migo/gateway/csrf', {
          headers: getAuthHeader()
        });
        
        if (!csrfResponse.data.success) {
          throw new Error('Failed to get CSRF token');
        }
        
        const response = await axios.post('https://sap-app-maoe.onrender.com/api/migo/gateway/post', {
          csrfToken: csrfResponse.data.csrfToken,
          cookies: csrfResponse.data.cookies,
          transferData: payload,
          isTestRun: false
        }, {
          headers: getAuthHeader()
        });
        
        if (response.data.success) {
          setTransferResult(response.data?.data || null);
          setShowSuccessPopup(false);
          setPostSuccessData(response.data?.data || null);
          setShowPostSuccessPopup(true);
        } else {
          throw new Error(response.data.error || 'Post failed');
        }
      }
    } catch (error) {
      setError(error.response?.data?.error || error.message);
      if (error.response?.status === 401) {
        navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/bsp', {
      state: {
        prefillBatches: batchData
      }
    });
  };

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

  if (!batchData) {
    return <div>Loading batch data...</div>;
  }

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
          <h2 style={{ marginTop: 0 }}>MIGO Transfer</h2>

          {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "0.75rem", borderRadius: "8px", marginTop: "0.5rem" }}>{error}</div>}
          {successMessage && <div style={{ background: "#dcfce7", color: "#166534", padding: "0.75rem", borderRadius: "8px", marginTop: "0.5rem" }}>{successMessage}</div>}

          <div className="form-group">
            <label>Sales Order From</label>
            <input
              type="text"
              name="salesOrder"
              value={formData.salesOrder}
              onChange={handleChange}
              className="form-control"
              required
              readOnly
              style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
            />
          </div>

          <div className="form-group">
            <label>Sales Order Item From</label>
            <input
              type="text"
              name="salesOrderItem"
              value={formData.salesOrderItem}
              onChange={handleChange}
              className="form-control"
              required
              readOnly
              style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
            />
          </div>

          <div className="form-group">
            <label>Movement Type</label>
            <select
              name="movementType"
              value={formData.movementType}
              onChange={handleChange}
              className="form-control"
              required
            >
              <option value="413">413</option>
              <option value="311">311</option>
            </select>
          </div>

          {formData.movementType === '413' && (
            <>
              <div className="form-group">
                <label>Sales Order To</label>
                <input
                  type="text"
                  name="salesOrderTo"
                  value={formData.salesOrderTo}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Same as Sales Order From if empty"
                />
              </div>

              <div className="form-group">
                <label>Sales Order Item To</label>
                <input
                  type="text"
                  name="salesOrderItemTo"
                  value={formData.salesOrderItemTo}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Same as Sales Order Item From if empty"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label>Storage Location To</label>
            <input
              type="text"
              name="storageLocationTo"
              value={formData.storageLocationTo}
              onChange={handleChange}
              className="form-control"
              required
            />
          </div>

          <div className="form-group">
            <label>Special Stock</label>
            <input
              type="text"
              name="specialStock"
              value={formData.specialStock}
              onChange={handleChange}
              className="form-control"
              required
            />
          </div>
        </div>
      </div>

      {showSuccessPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 50 }}>
          <div style={{ width: "100%", maxWidth: "520px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0 }}>Validation Successful</h3>
            <div style={{ background: "#dcfce7", color: "#166534", padding: "0.75rem", borderRadius: "8px", marginTop: "0.5rem" }}>
              Your data has been validated successfully. You can now post.
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.25rem" }}>
              <button
                onClick={() => {
                  setShowSuccessPopup(false);
                }}
                style={{ padding: "0.85rem 2rem", background: "#6b7280", color: "#fff", border: "none", borderRadius: "8px" }}
              >
                Back
              </button>

              <button
                onClick={handlePost}
                disabled={!validationPassed || loading}
                style={{ padding: "0.85rem 2rem", background: validationPassed && !loading ? "#22c55e" : "#9ca3af", color: "#fff", border: "none", borderRadius: "8px" }}
              >
                {loading ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPostSuccessPopup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 60 }}>
          <div style={{ width: "100%", maxWidth: "520px", background: "white", borderRadius: "12px", padding: "1.5rem", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>
            <h3 style={{ marginTop: 0 }}>Posted Successfully</h3>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "0.9rem", background: "#f9fafb" }}>
              <div style={{ fontWeight: 600, color: "#111827" }}>Document Number</div>
              <div style={{ marginTop: "0.25rem", fontSize: "1.1rem", color: "#111827" }}>
                {postSuccessData?.materialDocument || postSuccessData?.MatDoc || '-'}
              </div>
              {(postSuccessData?.message || postSuccessData?.Message) && (
                <div style={{ marginTop: "0.75rem", color: "#374151" }}>{postSuccessData?.message || postSuccessData?.Message}</div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button
                onClick={handleFetchAgain}
                style={{ padding: "0.85rem 2rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "8px" }}
              >
                Fetch Again
              </button>
            </div>
          </div>
        </div>
      )}

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
          onClick={handleCheck}
          disabled={loading}
          style={{ padding: "0.85rem 2rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "8px" }}
        >
          {loading ? 'Validating...' : 'Check'}
        </button>
      </div>
    </div>
  );
}

export default MigoPage;