FROM quay.io/keycloak/keycloak:26.0
COPY infrastructure/containers/keycloak-realm.json /opt/keycloak/data/import/realm.json
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--import-realm"]
