import { useState, useEffect } from 'react';
import axios from 'axios';
import { LogOut, Zap, Package, ArrowUpDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Dashboard() {
  const { token, user, logout } = useAuth();
  const [stock, setStock] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pushingEvent, setPushingEvent] = useState(false);
  
  const [formData, setFormData] = useState({
    product_id: '',
    event_type: 'Sale',
    quantity: '',
    unit_price: ''
  });

  const getAuthHeaders = () => {
    return { headers: { Authorization: `Bearer ${token}` } };
  };

  const fetchData = async () => {
    try {
      const stockRes = await axios.get(`${API_URL}/api/stock`, getAuthHeaders());
      setStock(stockRes.data);
      
      const ledgerRes = await axios.get(`${API_URL}/api/ledger`, getAuthHeaders());
      setLedger(ledgerRes.data);
    } catch (err) {
      console.error('Error fetching data', err);
      if (err.response?.status === 401) {
        handleLogout();
      }
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSimulate = async () => {
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/simulate`, {}, getAuthHeaders());
      setTimeout(fetchData, 1000);
    } catch (err) {
      console.error('Error simulating events', err);
      if (err.response?.status === 401) {
        handleLogout();
      }
    }
    setLoading(false);
  };
  
  const handlePushEvent = async (e) => {
    e.preventDefault();
    setPushingEvent(true);
    try {
      await axios.post(`${API_URL}/api/event`, {
        product_id: formData.product_id,
        event_type: formData.event_type.toLowerCase(),
        quantity: formData.quantity,
        unit_price: formData.event_type === 'Purchase' ? formData.unit_price : undefined
      }, getAuthHeaders());
      
      setFormData({ product_id: '', event_type: 'Sale', quantity: '', unit_price: '' });
      setTimeout(fetchData, 1000);
    } catch (err) {
      console.error('Error pushing event', err);
      if (err.response?.status === 401) {
        handleLogout();
      }
    }
    setPushingEvent(false);
  };

  const handleLogout = () => {
    logout();
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  };

  const uniqueSKUs = stock.length;
  const totalUnits = stock.reduce((acc, curr) => acc + parseInt(curr.current_quantity || 0), 0);
  const totalValue = stock.reduce((acc, curr) => acc + parseFloat(curr.total_inventory_cost || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-3 rounded-xl shrink-0">
              <Package className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-900 leading-tight">FIFO Inventory</h1>
              <p className="text-slate-500 text-sm">Welcome, {user?.full_name || user?.username || 'User'} 👋</p>
            </div>
          </div>
          <div className="flex w-full sm:w-auto space-x-3">
            <button 
              onClick={handleSimulate}
              disabled={loading}
              className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 transition-colors disabled:opacity-50 min-h-[44px]"
            >
              <Zap className="mr-0 sm:mr-2 w-4 h-4" /> 
              <span className="hidden sm:inline">Simulate 5 events</span>
            </button>
            <button 
              onClick={handleLogout}
              className="flex items-center justify-center p-2 md:px-4 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 transition-colors min-h-[44px]"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4 md:mr-2" /> 
              <span className="hidden md:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div className="flex items-center text-slate-500 mb-4">
              <Package className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">SKUs tracked</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">{uniqueSKUs}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div className="flex items-center text-slate-500 mb-4">
              <ArrowUpDown className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">Units in stock</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">{totalUnits.toLocaleString()}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
            <div className="flex items-center text-slate-500 mb-4">
              <TrendingUp className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">Inventory value</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">{formatCurrency(totalValue)}</div>
          </div>
        </div>

        {/* Two-column Section: Form & Stock Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Push Event Form (Left on Desktop, 4 cols) */}
          <div className="lg:col-span-4 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-slate-900">Push event</h2>
              <p className="text-sm text-slate-500 mt-1">Same payload as the Kafka topic</p>
            </div>
            <form onSubmit={handlePushEvent} className="space-y-4 flex-1 flex flex-col">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product ID</label>
                <input 
                  required
                  type="text" 
                  value={formData.product_id}
                  onChange={(e) => setFormData({...formData, product_id: e.target.value})}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  placeholder="e.g. PRD004"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Event type</label>
                <select 
                  value={formData.event_type}
                  onChange={(e) => setFormData({...formData, event_type: e.target.value})}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                >
                  <option>Sale</option>
                  <option>Purchase</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                <input 
                  required
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({...formData, quantity: e.target.value})}
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                  placeholder="0"
                />
              </div>
              {formData.event_type === 'Purchase' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit price</label>
                  <input 
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.unit_price}
                    onChange={(e) => setFormData({...formData, unit_price: e.target.value})}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 min-h-[44px]"
                    placeholder="0.00"
                  />
                </div>
              )}
              <div className="mt-auto pt-4">
                <button 
                  type="submit"
                  disabled={pushingEvent}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  {pushingEvent ? 'Sending...' : 'Send event'}
                </button>
              </div>
            </form>
          </div>

          {/* Stock Overview (Right on Desktop, 8 cols) */}
          <div className="lg:col-span-8 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="mb-6">
              <h2 className="text-lg font-bold text-slate-900">Product stock overview</h2>
              <p className="text-sm text-slate-500 mt-1">Cost from remaining FIFO batches</p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500">
                    <th className="py-3 px-4 font-medium">Product</th>
                    <th className="py-3 px-4 font-medium text-right">Qty</th>
                    <th className="py-3 px-4 font-medium text-right">Inventory cost</th>
                    <th className="py-3 px-4 font-medium text-right">Avg / unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {stock.map((item) => (
                    <tr key={item.product_id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-4 px-4 font-semibold text-slate-900">{item.product_id}</td>
                      <td className="py-4 px-4 text-slate-700 text-right">{item.current_quantity.toLocaleString()}</td>
                      <td className="py-4 px-4 font-medium text-slate-900 text-right">{formatCurrency(item.total_inventory_cost)}</td>
                      <td className="py-4 px-4 text-slate-700 text-right">{formatCurrency(item.average_cost_per_unit)}</td>
                    </tr>
                  ))}
                  {stock.length === 0 && (
                    <tr>
                      <td colSpan="4" className="py-8 text-center text-slate-500">No products yet — push a purchase event to get started.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Transaction Ledger */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900">Transaction ledger</h2>
            <p className="text-sm text-slate-500 mt-1">Sale cost = FIFO consumption of oldest batches</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="py-3 px-4 font-medium">Time</th>
                  <th className="py-3 px-4 font-medium">Product</th>
                  <th className="py-3 px-4 font-medium">Type</th>
                  <th className="py-3 px-4 font-medium text-right">Qty</th>
                  <th className="py-3 px-4 font-medium text-right">Unit price</th>
                  <th className="py-3 px-4 font-medium text-right">Total / FIFO cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {ledger.map((tx) => (
                  <tr key={tx.id + tx.type} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-4 text-slate-500">{new Date(tx.timestamp).toLocaleString()}</td>
                    <td className="py-4 px-4 font-semibold text-slate-900">{tx.product_id}</td>
                    <td className="py-4 px-4">
                      {tx.type === 'purchase' ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                          purchase
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-white">
                          sale
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-slate-700 text-right">{tx.quantity.toLocaleString()}</td>
                    <td className="py-4 px-4 text-slate-700 text-right">
                      {tx.type === 'purchase' ? formatCurrency(tx.price) : '—'}
                    </td>
                    <td className="py-4 px-4 font-medium text-slate-900 text-right">
                      {formatCurrency(tx.total_value)}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-slate-500">No transactions recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
