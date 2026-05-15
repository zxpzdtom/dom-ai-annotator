import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";

const remToPx = {
  postcssPlugin: "rem-to-px",
  Once(root) {
    root.walkDecls((decl) => {
      if (!decl.value.includes("rem")) return;
      decl.value = decl.value.replace(/(-?\d*\.?\d+)rem\b/g, (_, value) => `${Number(value) * 16}px`);
    });
  }
};

export default {
  plugins: [tailwindcss(), remToPx, autoprefixer()]
};
