import { formatMoney, getStatusTone, sanitizeText } from "./helpers";
import { getProductVisual } from "../shared/productVisuals";
import SoftPagination from "../shared/SoftPagination";

function InventoryDirectoryPanel({
  filteredProducts,
  filteredProductCount,
  stats,
  query,
  category,
  categories,
  inventoryLane,
  laneOptions,
  currentPage,
  totalPages,
  tableLoading,
  onPageChange,
  onCreateProduct,
  onQueryChange,
  onCategoryChange,
  onInventoryLaneChange,
  onPopulateForm,
  onQuickRestock,
  onDelete,
}) {
  const pageSize = 10;
  const pageStart = filteredProductCount ? (currentPage - 1) * pageSize + 1 : 0;
  const pageEnd = filteredProductCount ? Math.min(currentPage * pageSize, filteredProductCount) : 0;

  return (
    <section className="soft-panel inventory-directory-surface">
      <div className="panel-header soft-panel-header wrap-header inventory-directory-header">
        <div>
          <h3>Live stock directory</h3>
          <p className="panel-subtitle">
            Search the live catalog, filter by lane, and move straight into edits or replenishment.
          </p>
        </div>
        <div className="inventory-directory-header-actions">
          <span className="inventory-directory-badge">
            {filteredProductCount} live of {stats.totalProducts}
          </span>
          <button type="button" className="btn btn-primary btn-compact" onClick={onCreateProduct}>
            Create Product
          </button>
        </div>
      </div>

      <div className="inventory-directory-filterbar">
        <input
          className="input inventory-directory-search"
          placeholder="Search name, SKU, barcode, supplier, or category"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <select
          className="input toolbar-select inventory-directory-select"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="inventory-directory-lanes">
        {laneOptions.map((lane) => (
          <button
            key={lane.key}
            type="button"
            className={`inventory-directory-lane${inventoryLane === lane.key ? " is-active" : ""}`}
            onClick={() => onInventoryLaneChange(lane.key)}
          >
            <span>{lane.label}</span>
            <strong>{lane.count}</strong>
          </button>
        ))}
      </div>

      <div className="inventory-directory-table-wrap">
        {tableLoading ? (
          <div className="inventory-directory-feedback" role="status" aria-live="polite">
            <strong>Loading live inventory</strong>
            <p>Refreshing the current stock list, suppliers, and lane status.</p>
          </div>
        ) : filteredProducts.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Supplier</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Unit Price</th>
                <th>Stock Value</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const statusTone = getStatusTone(product.status);
                const visual = getProductVisual(product);

                return (
                  <tr key={product.id} className={`inventory-table-row ${product.lane}`}>
                    <td>
                      <div className="inventory-row-product">
                        <div className={`product-thumb product-thumb--${visual.tone}`}>
                          <img src={visual.image} alt={visual.alt} />
                        </div>
                        <div>
                          <div className="inventory-row-title">{product.name}</div>
                          <div className="inventory-row-subline">
                            {sanitizeText(product.sku)}
                            {product.barcode ? ` - ${sanitizeText(product.barcode)}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{sanitizeText(product.supplier) || "General Supplier"}</td>
                    <td>{sanitizeText(product.category) || "General"}</td>
                    <td>{Number(product.stock || 0)}</td>
                    <td>{formatMoney(product.price)}</td>
                    <td>{formatMoney(product.stockValue)}</td>
                    <td>
                      <span className={`status-pill ${statusTone}`}>{product.status}</span>
                    </td>
                    <td>
                      <div className="inventory-directory-actions">
                        <button
                          type="button"
                          className="btn btn-secondary small"
                          onClick={() => onPopulateForm(product)}
                        >
                          Edit Record
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary small"
                          onClick={() => onQuickRestock(product)}
                        >
                          Restock
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger small"
                          onClick={() => onDelete(product)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="inventory-directory-feedback">
            <strong>No products match this filter</strong>
            <p>Clear the search or switch lanes to reopen the live stock list.</p>
            <div className="inventory-directory-feedback-actions">
              <button type="button" className="btn btn-secondary btn-compact" onClick={onCreateProduct}>
                Create New SKU
              </button>
            </div>
          </div>
        )}
      </div>

      {!tableLoading && filteredProductCount ? (
        <div className="inventory-directory-footer">
          <div className="inventory-directory-footer-copy">
            <span>
              Showing {pageStart}-{pageEnd} of {filteredProductCount} live catalog lines
            </span>
            <small>Use the pager to move through the rest of the live stock list.</small>
          </div>
          <SoftPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={onPageChange}
            className="inventory-directory-pager"
            label="Inventory page navigation"
          />
        </div>
      ) : null}
    </section>
  );
}

export default InventoryDirectoryPanel;
