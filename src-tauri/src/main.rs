fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        if let Err(code) = pixel_ops_lib::local_helper::helper_entry(&args) {
            eprintln!("agent_world:{code}");
            std::process::exit(1);
        }
        return;
    }
    pixel_ops_lib::run();
}
