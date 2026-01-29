// frontend/src/pages/migoPage.js
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getUserCredentials } from '../api';

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
    
    // Auto-uppercase storage location to field
    if (name === 'storageLocationTo') {
      setFormData(prev => ({
        ...prev,
        [name]: value.toUpperCase()
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const getAuthHeader = () => {
    const token = localStorage.getItem('token');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  };

  const preparePayload = (isTestRun) => {
    const nowIso = new Date().toISOString();

    // Use "to" fields if entered, otherwise use "from" fields
    const finalSalesOrderTo = formData.salesOrderTo || formData.salesOrder;
    const finalSalesOrderItemTo = formData.salesOrderItemTo || formData.salesOrderItem;

    if (Array.isArray(batchData)) {
      const first = batchData[0];
      const firstContent = first.d || first;
      return {
        HeaderId: "1",
        DocDate: `/Date(${new Date(nowIso).getTime()})/`,
        PstngDate: `/Date(${new Date(nowIso).getTime()})/`,
        TestRun: isTestRun,
        // Use TransferItemSet format for backend compatibility
        TransferItemSet: batchData.map((batch, index) => {
          const batchItem = batch.d || batch;
          return {
            HeaderId: "1",
            ItemNo: String(index + 1).padStart(6, '0'),
            Material: String(batchItem.MATNR || '').padStart(18, '0'),
            Plant: batchItem.Werks || '',
            StgeLoc: batchItem.LGORT || '',
            Quantity: String(batchItem.QTY || '0'),
            EntryUom: batchItem.MEINS || '',
            Batch: batchItem.Charg || '',
            SalesOrder: firstContent.SalesOrder || formData.salesOrder,
            SoItem: firstContent.SoItem || formData.salesOrderItem,
            SpecStock: formData.specialStock || batchItem.SOBKZ || 'E',
            StgeLocTo: formData.storageLocationTo || '',
            BatchTo: batchItem.Charg || '',
            MoveType: formData.movementType,
            SalesOrderTo: finalSalesOrderTo,
            SoItemTo: finalSalesOrderItemTo
          };
        })
      };
    }

    const batchContent = batchData.d || batchData;
    return {
      HeaderId: "1",
      DocDate: `/Date(${new Date(nowIso).getTime()})/`,
      PstngDate: `/Date(${new Date(nowIso).getTime()})/`,
      TestRun: isTestRun,
      // Use TransferItemSet format for single item
      TransferItemSet: [{
        HeaderId: "1",
        ItemNo: "000001",
        Material: String(batchContent.MATNR || '').padStart(18, '0'),
        Plant: batchContent.Werks || '',
        StgeLoc: batchContent.LGORT || '',
        Quantity: String(batchContent.QTY || '0'),
        EntryUom: batchContent.MEINS || '',
        Batch: batchContent.Charg || '',
        SalesOrder: batchContent.SalesOrder || formData.salesOrder,
        SoItem: batchContent.SoItem || formData.salesOrderItem,
        SpecStock: formData.specialStock || batchContent.SOBKZ || 'E',
        StgeLocTo: formData.storageLocationTo || '',
        BatchTo: batchContent.Charg || '',
        MoveType: formData.movementType,
        SalesOrderTo: finalSalesOrderTo,
        SoItemTo: finalSalesOrderItemTo
      }]
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
    // Validate storage location before proceeding
    if (!formData.storageLocationTo.trim()) {
      setError('Storage Location To is required. Please enter a value before proceeding.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const creds = getUserCredentials();
      if (!creds) throw new Error('User not authenticated. Please log in again.');

      const payload = preparePayload(isTestRun);
      const endpoint = isTestRun ? '/api/migo/check' : '/api/migo/post';
      const url = `http://192.168.60.107:5000${endpoint}`;

      const response = await axios.post(url, payload, {
        headers: {
          'X-User-Auth': btoa(`${creds.username}:${creds.password}`),
          'X-User-Environment': creds.environment,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        if (isTestRun) {
          setTransferResult(response.data.data);
          setValidationPassed(true);
          setSuccessMessage('Validation successful!');
          setShowSuccessPopup(true);
        } else {
          setPostSuccessData(response.data.data);
          setShowPostSuccessPopup(true);
        }
      } else {
        throw new Error(response.data.error || 'Operation failed');
      }
    } catch (err) {
      console.error('Transfer error:', err);
      setError(err.response?.data?.error || err.message || 'Operation failed');
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