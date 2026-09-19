fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_world_snapshot",
            "detect_hermes",
            "configure_hermes",
            "detect_remote_hermes",
            "configure_remote_hermes",
            "configured_remote",
            "recover_configuration",
            "open_company_site",
        ]),
    ))
    .expect("build application command permissions");
}
