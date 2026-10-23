use std::{env, fs, path::PathBuf};
fn main() {
    let source =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../test-support/src/main.rs");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(&source).unwrap();
    let slices = [
        &text[text.find("use ckb_chain_spec").unwrap()..text.find("struct Setup").unwrap()],
        &text[text.find("struct Setup").unwrap()..text.find("fn genesis(").unwrap()],
        &text[text.find("fn replace_output_data(").unwrap()..text.find("fn generate(").unwrap()],
        &text[text.find("fn run_one(").unwrap()..text.find("fn run(root").unwrap()],
    ];
    let output = slices
        .join("\n")
        .replace("root.join(\"binaries\").join(n)", "binary_path(root,n)");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("f0_support.rs"),
        output,
    )
    .unwrap();
}
