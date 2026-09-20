use std::path::Path;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: verify-update /public-key.pub /candidate-directory");
        std::process::exit(2);
    }
    match pixel_ops_lib::verify_update_candidate(Path::new(&args[1]), Path::new(&args[2])) {
        Ok(version) => println!(
            "Verified update candidate {version}: signed manifest, version, platforms, URL, size and archive digest."
        ),
        Err(code) => {
            eprintln!("Verification refused: {code}");
            std::process::exit(1);
        }
    }
}
