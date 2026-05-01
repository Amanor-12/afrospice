import ProductIdentityBadge from "./ProductIdentityBadge";
import { resolveProductImage } from "./productMedia";

function ProductMediaBadge({ product, className = "", alt = "" }) {
  const imageSrc = resolveProductImage(product);
  const classes = ["product-media-badge", className].filter(Boolean).join(" ");

  if (!imageSrc) {
    return <ProductIdentityBadge product={product} className={className} />;
  }

  return (
    <div className={classes}>
      <img
        src={imageSrc}
        alt={alt || String(product?.name || "Product")}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

export default ProductMediaBadge;
